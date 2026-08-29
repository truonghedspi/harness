package io.harness.logcontext.deploy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Cluster access policy test for feat-010.
 *
 * <p>This is a static policy oracle over the REAL Helm templates — {@code rbac.yaml} and
 * {@code networkpolicy.yaml} — rendered (template variables substituted) and parsed into a
 * structure, never a hard-coded copy of the expected YAML. It fails on an assertion when either
 * artifact is absent or violates the owner-approved minimal nonprod policy:
 *
 * <ul>
 *   <li>the collector ClusterRole is the upstream-default set (core pods/namespaces/nodes; apps
 *       replicasets/deployments/statefulsets/daemonsets; batch jobs; extensions replicasets — all
 *       get/list/watch), with no {@code *} verbs/resources,
 *   <li>the {@code -service} ServiceAccount exists with NO Kubernetes RBAC (no Role/RoleBinding/
 *       ClusterRole/ClusterRoleBinding names it),
 *   <li>one default-deny-ingress NetworkPolicy selects the service pod and admits only
 *       cluster-internal TCP 8080, and
 *   <li>there is no MCP→ingest edge — the single service pod carries both surfaces, so no rule or
 *       selector names an mcp or ingest component as a separate surface.
 * </ul>
 */
class ClusterAccessPolicyTest {

    static final String RBAC_PATH = "charts/log-debug-context/templates/rbac.yaml";
    static final String NETPOL_PATH = "charts/log-debug-context/templates/networkpolicy.yaml";

    /** Release name substituted for {@code {{ .Release.Name }}} when rendering the templates. */
    static final String RELEASE = "test-release";
    static final String NAMESPACE = "test-namespace";

    static final Set<String> ALLOWED_API_GROUPS = Set.of("", "apps", "batch", "extensions");
    static final Set<String> ALLOWED_RESOURCES =
            Set.of("pods", "namespaces", "nodes", "replicasets", "deployments", "statefulsets", "daemonsets", "jobs");
    static final Set<String> ALLOWED_VERBS = Set.of("get", "list", "watch");

    @Test
    void collectorClusterRoleIsUpstreamDefaultNotBroad() {
        List<Map<String, Object>> docs = parseDocuments(render(readRequired(RBAC_PATH)));
        List<Map<String, Object>> roles = docsOfKind(docs, "ClusterRole");
        assertEquals(1, roles.size(), "rbac.yaml must define exactly one collector ClusterRole");

        Map<String, Object> role = roles.get(0);
        assertEquals(RELEASE + "-collector", metadataName(role),
                "ClusterRole must be the {{ .Release.Name }}-collector role");
        assertNotNull(role.get("rules"), "ClusterRole must declare rules");

        Set<String> resourcesSeen = new HashSet<>();
        Set<String> verbsSeen = new HashSet<>();
        Set<String> apiGroupsSeen = new HashSet<>();
        for (Object ruleObj : asList(role.get("rules"))) {
            Map<String, Object> rule = asMap(ruleObj);
            List<Object> apiGroups = asList(rule.get("apiGroups"));
            List<Object> resources = asList(rule.get("resources"));
            List<Object> verbs = asList(rule.get("verbs"));

            for (Object apiGroup : apiGroups) {
                String group = (String) apiGroup;
                assertFalse("*".equals(group), "no rule may use a wildcard apiGroup");
                assertTrue(ALLOWED_API_GROUPS.contains(group),
                        "apiGroup '" + group + "' is outside the upstream collector set: " + ALLOWED_API_GROUPS);
                apiGroupsSeen.add(group);
            }
            for (Object resource : resources) {
                String res = (String) resource;
                assertFalse("*".equals(res), "no rule may use a wildcard resource");
                assertTrue(ALLOWED_RESOURCES.contains(res),
                        "resource '" + res + "' is outside the upstream collector set: " + ALLOWED_RESOURCES);
                resourcesSeen.add(res);
            }
            for (Object verb : verbs) {
                String v = (String) verb;
                assertFalse("*".equals(v), "no rule may use a wildcard verb");
                assertTrue(ALLOWED_VERBS.contains(v),
                        "verb '" + v + "' is outside the read-only get/list/watch set: " + ALLOWED_VERBS);
                verbsSeen.add(v);
            }
        }

        // The intended read path must remain intact: the stock rule set, not a hand-trimmed one.
        assertEquals(ALLOWED_RESOURCES, resourcesSeen,
                "collector ClusterRole must grant exactly the upstream resources, no fewer and no more");
        assertEquals(ALLOWED_VERBS, verbsSeen,
                "collector ClusterRole must grant get/list/watch, no fewer and no more");
        assertEquals(ALLOWED_API_GROUPS, apiGroupsSeen,
                "collector ClusterRole must span exactly core/apps/batch/extensions, no fewer and no more");
    }

    @Test
    void serviceServiceAccountHasNoKubernetesRbac() {
        List<Map<String, Object>> docs = parseDocuments(render(readRequired(RBAC_PATH)));

        List<Map<String, Object>> accounts = docsOfKind(docs, "ServiceAccount");
        List<Map<String, Object>> serviceAccounts = new ArrayList<>();
        for (Map<String, Object> account : accounts) {
            if ((RELEASE + "-service").equals(metadataName(account))) {
                serviceAccounts.add(account);
            }
        }
        assertEquals(1, serviceAccounts.size(),
                "rbac.yaml must define exactly one {{ .Release.Name }}-service ServiceAccount");

        // No Role/RoleBinding/ClusterRole/ClusterRoleBinding may grant anything to the -service SA.
        for (Map<String, Object> doc : docs) {
            String kind = (String) doc.get("kind");
            if (kind == null || !kind.endsWith("Binding")) {
                continue;
            }
            Object subjects = doc.get("subjects");
            if (subjects == null) {
                continue;
            }
            for (Object subjectObj : asList(subjects)) {
                Map<String, Object> subject = asMap(subjectObj);
                String name = (String) subject.get("name");
                assertFalse((RELEASE + "-service").equals(name),
                        "no binding may reference the -service ServiceAccount; it must hold no Kubernetes RBAC");
            }
        }

        // The collector binding must target the -collector account, not the -service account.
        List<Map<String, Object>> bindings = docsOfKind(docs, "ClusterRoleBinding");
        assertEquals(1, bindings.size(), "rbac.yaml must define exactly one collector ClusterRoleBinding");
        boolean collectorBound = false;
        for (Object subjectObj : asList(bindings.get(0).get("subjects"))) {
            Map<String, Object> subject = asMap(subjectObj);
            if ("ServiceAccount".equals(subject.get("kind"))
                    && (RELEASE + "-collector").equals(subject.get("name"))) {
                collectorBound = true;
            }
        }
        assertTrue(collectorBound, "ClusterRoleBinding must bind the -collector ServiceAccount to the collector role");
    }

    @Test
    void networkPolicyIsDefaultDenyIngressOnServicePod() {
        List<Map<String, Object>> docs = parseDocuments(render(readRequired(NETPOL_PATH)));
        assertEquals(1, docs.size(), "networkpolicy.yaml must define exactly one NetworkPolicy");

        Map<String, Object> policy = docs.get(0);
        assertEquals("NetworkPolicy", policy.get("kind"), "the single policy must be a NetworkPolicy");

        Map<String, Object> spec = asMap(policy.get("spec"));
        Map<String, Object> podSelector = asMap(spec.get("podSelector"));
        assertEquals("service", componentLabel(podSelector),
                "the policy must select the service pod (app.kubernetes.io/component: service)");

        List<Object> policyTypes = asList(spec.get("policyTypes"));
        assertEquals(List.of("Ingress"), policyTypes,
                "policyTypes must be exactly [Ingress] — default-deny ingress, egress left default-allowed (nonprod)");
        assertFalse(spec.containsKey("egress"),
                "no egress rules may be declared: the service→OpenSearch and issuer-discovery egress is default-allowed");

        List<Object> ingress = asList(spec.get("ingress"));
        assertTrue(!ingress.isEmpty(), "the policy must admit the intended ingress path");

        boolean clusterInternalTcp8080 = false;
        Set<String> allowedPorts = new HashSet<>();
        for (Object ruleObj : ingress) {
            Map<String, Object> rule = asMap(ruleObj);
            List<Object> from = asList(rule.get("from"));
            List<Object> ports = asList(rule.get("ports"));
            for (Object fromObj : from) {
                Map<String, Object> fromMap = asMap(fromObj);
                assertFalse(fromMap.containsKey("ipBlock"),
                        "the policy must stay cluster-internal: no ipBlock source may admit non-cluster traffic");
                Object nsSelector = fromMap.get("namespaceSelector");
                if (nsSelector != null && asMap(nsSelector).isEmpty()) {
                    for (Object portObj : ports) {
                        Map<String, Object> port = asMap(portObj);
                        String protocol = (String) port.get("protocol");
                        String number = String.valueOf(port.get("port"));
                        allowedPorts.add(protocol + "/" + number);
                        if ("TCP".equals(protocol) && "8080".equals(number)) {
                            clusterInternalTcp8080 = true;
                        }
                    }
                }
            }
        }
        assertTrue(clusterInternalTcp8080,
                "the policy must admit cluster-internal pods (namespaceSelector {}) on TCP 8080");
        assertEquals(Set.of("TCP/8080"), allowedPorts,
                "the policy must admit TCP 8080 ONLY — no additional ingress port may widen the surface");
    }

    @Test
    void noMcpToIngestEdgeIsEncoded() {
        List<Map<String, Object>> docs = parseDocuments(render(readRequired(NETPOL_PATH)));
        assertEquals(1, docs.size(), "there must be exactly one NetworkPolicy — the service surface, not per-edge objects");

        Map<String, Object> policy = docs.get(0);
        // The one pod hosts both ingest and MCP; no rule or selector may name an mcp/ingest surface.
        List<String> values = new ArrayList<>();
        collectStrings(policy, values);
        assertFalse(values.contains("mcp"),
                "no rule or selector may name an mcp component as a separate surface (no MCP→ingest edge)");
        assertFalse(values.contains("ingest"),
                "no rule or selector may name an ingest component as a separate surface (no MCP→ingest edge)");
        assertTrue(values.contains("service"),
                "the policy must select the single service surface that hosts both ingest and MCP");
    }

    // --- rendering + minimal YAML subset parsing (indentation, maps, lists, flow lists) ---

    private static String render(String template) {
        String rendered = template
                .replace("{{ .Release.Name }}", RELEASE)
                .replace("{{ .Release.Namespace }}", NAMESPACE);
        assertFalse(rendered.contains("{{"),
                "template left an unrendered Helm expression: " + templateLineContaining(rendered, "{{"));
        return rendered;
    }

    private static String templateLineContaining(String rendered, String needle) {
        for (String line : rendered.split("\n", -1)) {
            if (line.contains(needle)) {
                return line.trim();
            }
        }
        return "<none>";
    }

    private static List<Map<String, Object>> parseDocuments(String text) {
        List<Map<String, Object>> docs = new ArrayList<>();
        List<String> lines = new ArrayList<>();
        for (String raw : text.split("\n", -1)) {
            String trimmed = raw.trim();
            if (trimmed.equals("---")) {
                flush(lines, docs);
                lines.clear();
                continue;
            }
            if (trimmed.isEmpty() || trimmed.startsWith("#")) {
                continue;
            }
            lines.add(stripInlineComment(raw));
        }
        flush(lines, docs);
        assertFalse(docs.isEmpty(), "rendered template must contain at least one YAML document");
        return docs;
    }

    private static void flush(List<String> lines, List<Map<String, Object>> docs) {
        if (lines.isEmpty()) {
            return;
        }
        int[] indents = new int[lines.size()];
        String[] contents = new String[lines.size()];
        for (int i = 0; i < lines.size(); i++) {
            String line = lines.get(i);
            int indent = 0;
            while (indent < line.length() && line.charAt(indent) == ' ') {
                indent++;
            }
            indents[i] = indent;
            contents[i] = line.substring(indent);
        }
        Object root = parseValue(contents, indents, new Cursor(), indents[0]);
        assertTrue(root instanceof Map, "YAML document root must be a map, got: " + root);
        @SuppressWarnings("unchecked")
        Map<String, Object> map = (Map<String, Object>) root;
        docs.add(map);
    }

    private static String stripInlineComment(String line) {
        int hash = line.indexOf(" #");
        return hash >= 0 ? line.substring(0, hash) : line;
    }

    private static final class Cursor {
        int i;
    }

    private static Object parseValue(String[] contents, int[] indents, Cursor c, int indent) {
        if (contents[c.i].startsWith("-")) {
            return parseList(contents, indents, c, indent);
        }
        return parseMap(contents, indents, c, indent);
    }

    private static Map<String, Object> parseMap(String[] contents, int[] indents, Cursor c, int indent) {
        Map<String, Object> map = new LinkedHashMap<>();
        while (c.i < contents.length && indents[c.i] == indent && !contents[c.i].startsWith("-")) {
            String line = contents[c.i];
            int colon = findKeyColon(line);
            String key = line.substring(0, colon).trim();
            String rest = line.substring(colon + 1).trim();
            c.i++;
            if (rest.isEmpty()) {
                if (c.i < contents.length && indents[c.i] > indent) {
                    map.put(key, parseValue(contents, indents, c, indents[c.i]));
                } else {
                    map.put(key, null);
                }
            } else {
                map.put(key, parseScalar(rest));
            }
        }
        return map;
    }

    private static List<Object> parseList(String[] contents, int[] indents, Cursor c, int indent) {
        List<Object> list = new ArrayList<>();
        while (c.i < contents.length && indents[c.i] == indent && contents[c.i].startsWith("-")) {
            String item = contents[c.i].substring(1).trim();
            c.i++;
            if (item.isEmpty()) {
                if (c.i < contents.length && indents[c.i] > indent) {
                    list.add(parseValue(contents, indents, c, indents[c.i]));
                } else {
                    list.add(null);
                }
                continue;
            }
            if (isMapEntry(item)) {
                int colon = findKeyColon(item);
                String key = item.substring(0, colon).trim();
                String rest = item.substring(colon + 1).trim();
                Map<String, Object> map = new LinkedHashMap<>();
                if (rest.isEmpty()) {
                    if (c.i < contents.length && indents[c.i] > indent) {
                        map.put(key, parseValue(contents, indents, c, indents[c.i]));
                    } else {
                        map.put(key, null);
                    }
                } else {
                    map.put(key, parseScalar(rest));
                }
                if (c.i < contents.length && indents[c.i] > indent && !contents[c.i].startsWith("-")) {
                    Object cont = parseMap(contents, indents, c, indents[c.i]);
                    map.putAll(asMap(cont));
                }
                list.add(map);
            } else {
                list.add(parseScalar(item));
            }
        }
        return list;
    }

    private static boolean isMapEntry(String item) {
        return item.contains(": ") || item.endsWith(":");
    }

    private static int findKeyColon(String line) {
        int idx = line.indexOf(": ");
        if (idx >= 0) {
            return idx;
        }
        if (line.endsWith(":")) {
            return line.length() - 1;
        }
        throw new AssertionError("no key/value colon in line: '" + line + "'");
    }

    private static Object parseScalar(String scalar) {
        String s = scalar.trim();
        if (s.equals("{}")) {
            return new LinkedHashMap<String, Object>();
        }
        if (s.equals("[]")) {
            return new ArrayList<Object>();
        }
        if (s.startsWith("[") && s.endsWith("]")) {
            String inner = s.substring(1, s.length() - 1).trim();
            List<Object> list = new ArrayList<>();
            if (!inner.isEmpty()) {
                for (String part : inner.split(",")) {
                    list.add(unquote(part.trim()));
                }
            }
            return list;
        }
        return unquote(s);
    }

    private static String unquote(String s) {
        if (s.length() >= 2 && ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'")))) {
            return s.substring(1, s.length() - 1);
        }
        return s;
    }

    private static void collectStrings(Object node, List<String> out) {
        if (node instanceof Map<?, ?> map) {
            for (Object value : map.values()) {
                collectStrings(value, out);
            }
        } else if (node instanceof List<?> list) {
            for (Object value : list) {
                collectStrings(value, out);
            }
        } else if (node instanceof String s) {
            out.add(s);
        }
    }

    private static String metadataName(Map<String, Object> doc) {
        Object metadata = doc.get("metadata");
        if (metadata instanceof Map<?, ?> m && m.get("name") != null) {
            return String.valueOf(m.get("name"));
        }
        return null;
    }

    private static Object componentLabel(Map<String, Object> podSelector) {
        Object matchLabels = podSelector.get("matchLabels");
        if (matchLabels instanceof Map<?, ?> m) {
            return m.get("app.kubernetes.io/component");
        }
        return null;
    }

    private static List<Map<String, Object>> docsOfKind(List<Map<String, Object>> docs, String kind) {
        List<Map<String, Object>> matches = new ArrayList<>();
        for (Map<String, Object> doc : docs) {
            if (kind.equals(doc.get("kind"))) {
                matches.add(doc);
            }
        }
        return matches;
    }

    private static Map<String, Object> asMap(Object value) {
        assertTrue(value instanceof Map, "expected a YAML map but got: " + value);
        @SuppressWarnings("unchecked")
        Map<String, Object> map = (Map<String, Object>) value;
        return map;
    }

    private static List<Object> asList(Object value) {
        assertTrue(value instanceof List, "expected a YAML list but got: " + value);
        @SuppressWarnings("unchecked")
        List<Object> list = (List<Object>) value;
        return list;
    }

    private static String readRequired(String path) {
        Path file = Path.of(path);
        if (!Files.isRegularFile(file)) {
            return fail("required deployment artifact is absent: " + path + " (at " + file.toAbsolutePath() + ")");
        }
        try {
            return Files.readString(file, StandardCharsets.UTF_8);
        } catch (java.io.IOException e) {
            return fail("cannot read required deployment artifact " + path + ": " + e.getMessage());
        }
    }
}
