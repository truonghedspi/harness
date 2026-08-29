package io.harness.logcontext.deploy;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * Deployment policy test for the node-level collector (feat-008).
 *
 * <p>This is a static policy oracle over the real deployment artifacts — the Helm DaemonSet
 * template, the collector pipeline config, the immutable image lock, and the Java collector
 * contract seam — not a cluster or container run (those are the Level-3 journey and the
 * feat-009 collector-to-ingest contract respectively). It fails on an assertion when any
 * artifact is absent or violates the approved policy, never by compiling against a fixture.
 *
 * <p>The opt-in / enrichment / schemaVersion / egress policy is asserted against BOTH copies of the
 * collector pipeline: {@code collector/otel-collector.yaml} (the hermetic bootstrap config) and the
 * ConfigMap embedded in {@code charts/.../collector-daemonset.yaml} (the config the Helm deployment
 * actually runs). They are two hand-maintained copies, so each must carry the same markers — a
 * chart that drops its opt-in filter must fail here even though the standalone config is intact.
 */
class CollectorDeploymentPolicyTest {

    /** Owner-approved immutable collector image (collector/contract-image.lock). */
    static final String CONTRACT_IMAGE =
            "otel/opentelemetry-collector-contrib:0.159.0@sha256:1f2c54a30e713fac6b3ae77a1ec84010c2007e29ced8ec666214fc2f6739c1cc";

    static final String CHART_PATH = "charts/log-debug-context/templates/collector-daemonset.yaml";
    static final String CONFIG_PATH = "collector/otel-collector.yaml";
    static final String LOCK_PATH = "collector/contract-image.lock";

    @Test
    void chartIsAScopedDaemonSetWithLoudPreflight() {
        String chart = readRequired(CHART_PATH);
        assertTrue(chart.contains("kind: DaemonSet"),
                "collector must be a node-level DaemonSet (X-001), not a Deployment or sidecar");
        assertTrue(chart.contains("node-log-preflight"),
                "chart must preflight node-log access before the collector starts (A-006 tripwire)");
        assertTrue(chart.contains("PREFLIGHT_FAILED"),
                "preflight must fail loudly (clear message) when node-log access is denied");
    }

    @Test
    void chartDoesNotBroadenHostAccessAndKeepsSidecarFallback() {
        String chart = readRequired(CHART_PATH);
        assertTrue(chart.contains("readOnly: true"),
                "host log mount must be read-only; the collector must not write the node filesystem");
        assertFalse(chart.contains("privileged: true"),
                "collector must not run privileged; node-log access is scoped read-only");
        assertFalse(chart.contains("hostNetwork: true"),
                "collector must not join the host network");
        assertFalse(chart.contains("hostPID: true"),
                "collector must not join the host PID namespace");
        assertTrue(chart.toLowerCase().contains("sidecar"),
                "sidecar must remain the explicit documented fallback for node-inaccessible logs (A-006)");
        assertTrue(chart.contains(CONTRACT_IMAGE),
                "chart must pin the immutable collector image recorded in collector/contract-image.lock");
    }

    @Test
    void collectorConfigCollectsOnlyOptedInAndEnrichesIdentityAndRunId() {
        assertOptInAndEnrichment("collector/otel-collector.yaml", readRequired(CONFIG_PATH));
        assertOptInAndEnrichment("chart ConfigMap (collector-daemonset.yaml)", readRequired(CHART_PATH));
    }

    @Test
    void collectorConfigSendsOnlyToIngest() {
        assertEgressOnly("collector/otel-collector.yaml", readRequired(CONFIG_PATH));
        assertEgressOnly("chart ConfigMap (collector-daemonset.yaml)", readRequired(CHART_PATH));
    }

    @Test
    void imageLockIsImmutableAndPinnedToApprovedDigest() {
        String lock = readRequired(LOCK_PATH).trim();
        assertEquals(CONTRACT_IMAGE, lock,
                "contract-image.lock must pin the owner-approved immutable multi-platform digest");
    }

    @Test
    void bootstrapValidatesContractAndExposesStartSeam() {
        Class<?> bootstrap = contractType("io.harness.logcontext.collector.CollectorContractBootstrap");
        Class<?> configType = contractType("io.harness.logcontext.collector.CollectorContractConfig");
        Class<?> runningType = contractType("io.harness.logcontext.collector.RunningCollector");

        Method start = requireMethod(bootstrap, "start", configType);
        assertTrue(Modifier.isStatic(start.getModifiers()),
                "CollectorContractBootstrap.start must be a static lifecycle seam");
        assertTrue(runningType.isAssignableFrom(start.getReturnType()),
                "CollectorContractBootstrap.start must return a RunningCollector");

        Method validate = requireMethod(bootstrap, "validateContract", String.class, String.class);
        assertTrue(Modifier.isStatic(validate.getModifiers()),
                "CollectorContractBootstrap.validateContract must be a static validation seam");

        String lock = readRequired(LOCK_PATH).trim();
        String config = readRequired(CONFIG_PATH);

        assertDoesNotThrow(() -> invoke(validate, null, lock, config),
                "bootstrap must accept the real approved lock and collector config");

        String wrongLock = "otel/opentelemetry-collector-contrib:0.159.0@sha256:" + "0".repeat(64);
        assertThrows(IllegalArgumentException.class, () -> invoke(validate, null, wrongLock, config),
                "bootstrap must reject an image lock whose digest is not the approved immutable value");

        String configWithoutOptIn = config.replace("debug.logs/enabled", "debug.logs/disabled");
        assertThrows(IllegalArgumentException.class, () -> invoke(validate, null, lock, configWithoutOptIn),
                "bootstrap must reject a collector config whose opt-in filter is absent");
    }

    private static void assertOptInAndEnrichment(String source, String config) {
        assertTrue(config.contains("debug.logs/enabled") && config.contains("\"true\""),
                source + " must admit only workloads opted in via the debug.logs/enabled=true label (X-003)");
        assertTrue(config.contains("environment") && config.contains("\"test\""),
                source + " must admit only the test environment (X-003)");
        for (String identity : List.of("namespace", "pod", "container", "workload")) {
            assertTrue(config.contains(identity),
                    source + " must enrich the identity field '" + identity + "' (INV-META-1)");
        }
        assertTrue(config.contains("test.run_id"),
                source + " must propagate the test.run_id correlation attribute (INV-META-1)");
        assertTrue(config.contains("set(attributes[\"schemaVersion\"], 1)"),
                source + " must serialize the schemaVersion-1 ingress shape with the value 1 (X-008)");
    }

    private static void assertEgressOnly(String source, String config) {
        assertTrue(config.contains("otlphttp"),
                source + " must export over HTTP to the serialized-ingress endpoint");
        assertTrue(config.contains("INGEST_ENDPOINT"),
                source + " egress must target the configured ingest endpoint, not a hardcoded sink");
        assertTrue(config.contains("health_check"),
                source + " must expose a health endpoint for readiness-bounded startup");
        assertFalse(matchesExporterKey(config, "debug"),
                source + " must not define a debug exporter (records would bypass ingest)");
        assertFalse(matchesExporterKey(config, "logging"),
                source + " must not define a logging exporter (records would bypass ingest)");
        assertFalse(matchesExporterKey(config, "file"),
                source + " must not define a file exporter (records would bypass ingest)");
    }

    /** True when a line (at any indentation) declares the given exporter/extension key. */
    private static boolean matchesExporterKey(String text, String exporter) {
        return Pattern.compile("(?m)^[ \\t]*" + Pattern.quote(exporter) + ":").matcher(text).find();
    }

    private static Class<?> contractType(String name) {
        try {
            return Class.forName(name);
        } catch (ClassNotFoundException e) {
            return fail("required collector contract type is absent: " + name, e);
        }
    }

    private static Method requireMethod(Class<?> type, String name, Class<?>... parameterTypes) {
        try {
            return type.getMethod(name, parameterTypes);
        } catch (NoSuchMethodException e) {
            return fail("required collector contract method is absent: " + type.getName() + "#" + name, e);
        }
    }

    private static Object invoke(Method method, Object target, Object... args) {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException e) {
            Throwable cause = e.getCause();
            if (cause instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            if (cause instanceof Error error) {
                throw error;
            }
            throw new RuntimeException(cause);
        } catch (IllegalAccessException e) {
            throw new RuntimeException(e);
        }
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
