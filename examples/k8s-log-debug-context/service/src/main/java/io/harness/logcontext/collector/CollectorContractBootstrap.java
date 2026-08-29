package io.harness.logcontext.collector;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.TimeUnit;

/**
 * Executable boundary for the non-cluster collector contract.
 *
 * <p>{@link #start(CollectorContractConfig)} runs the real collector configuration from
 * {@code collector/otel-collector.yaml} inside the OCI image pinned by
 * {@code collector/contract-image.lock}, with the fixture directory mounted read-only at
 * {@code /fixtures}. It exposes no host-log path. {@link #validateContract} is the pure
 * bootstrap/validation seam: it rejects any image lock other than the approved immutable digest
 * and any collector config missing a required policy marker, before a runtime is ever started.
 */
public final class CollectorContractBootstrap {

    /** The owner-approved immutable collector image (mirrors collector/contract-image.lock). */
    public static final String CONTRACT_IMAGE =
            "otel/opentelemetry-collector-contrib:0.159.0@sha256:1f2c54a30e713fac6b3ae77a1ec84010c2007e29ced8ec666214fc2f6739c1cc";

    private static final Path CONFIG_PATH = Path.of("collector", "otel-collector.yaml");
    private static final Path LOCK_PATH = Path.of("collector", "contract-image.lock");
    private static final URI HEALTH_URI = URI.create("http://127.0.0.1:13133/");

    private CollectorContractBootstrap() {
    }

    /**
     * Validates the collector contract without starting a runtime. The image lock line must be
     * exactly the approved immutable reference, and the config must carry the opt-in filter, the
     * schemaVersion marker, the ingest exporter, and the health endpoint.
     *
     * @throws IllegalArgumentException when either input violates the contract
     */
    public static void validateContract(String imageLockLine, String collectorConfig) {
        String lock = imageLockLine == null ? "" : imageLockLine.trim();
        if (!CONTRACT_IMAGE.equals(lock)) {
            throw new IllegalArgumentException(
                    "collector image is not the approved immutable lock; expected " + CONTRACT_IMAGE);
        }
        String config = collectorConfig == null ? "" : collectorConfig;
        for (String required : List.of("debug.logs/enabled", "schemaVersion", "otlphttp", "health_check")) {
            if (!config.contains(required)) {
                throw new IllegalArgumentException("collector config is missing required policy marker: " + required);
            }
        }
    }

    /**
     * Starts the real collector runtime. An unavailable permitted container runtime or unavailable
     * pinned image surfaces as an exception/checkpoint, never a fake collector.
     */
    public static RunningCollector start(CollectorContractConfig config) {
        Objects.requireNonNull(config, "config");
        validateRepoContract();

        Path fixture = config.fixtureDirectory().resolve("pod-logs.json");
        if (!Files.isRegularFile(fixture)) {
            throw new IllegalArgumentException("collector fixture is absent: " + fixture.toAbsolutePath());
        }

        String containerName = "log-context-collector-contract-" + Long.toUnsignedString(System.nanoTime(), 36);
        List<String> command = List.of(
                "docker", "run", "--rm", "--name", containerName,
                "--network", "host",
                "-v", fixture.getParent().toAbsolutePath() + ":/fixtures:ro",
                "-v", CONFIG_PATH.toAbsolutePath() + ":/etc/otelcol-contrib/config.yaml:ro",
                "-e", "INGEST_ENDPOINT=" + config.ingestEndpoint(),
                CONTRACT_IMAGE);

        try {
            // `docker run` (no -d) stays in the foreground and owns the container lifecycle; with
            // --rm it also removes the container once it stops. The returned handle stops it via
            // `docker stop`/`docker rm -f`, so the foreground process is not waited on here.
            new ProcessBuilder(command)
                    .redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .start();
        } catch (IOException e) {
            throw new UncheckedIOException("cannot start the collector container runtime: " + e.getMessage(), e);
        }
        return new DockerRunningCollector(containerName, config);
    }

    private static void validateRepoContract() {
        String lock = read(LOCK_PATH, "collector image lock");
        String config = read(CONFIG_PATH, "collector config");
        validateContract(lock, config);
    }

    private static String read(Path path, String label) {
        try {
            return Files.readString(path, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read " + label + " at " + path.toAbsolutePath() + ": " + e.getMessage(), e);
        }
    }

    private static final class DockerRunningCollector implements RunningCollector {
        private final String containerName;
        private final CollectorContractConfig config;

        DockerRunningCollector(String containerName, CollectorContractConfig config) {
            this.containerName = containerName;
            this.config = config;
        }

        @Override
        public void awaitReady() {
            HttpClient client = HttpClient.newHttpClient();
            long deadlineNanos = System.nanoTime() + config.readyDeadline().toNanos();
            while (System.nanoTime() < deadlineNanos) {
                if (healthResponds(client)) {
                    return;
                }
                sleepQuietly(200);
            }
            throw new IllegalStateException(
                    "collector health endpoint did not respond within " + config.readyDeadline());
        }

        @Override
        public void close() {
            docker("stop", containerName);
            long deadlineNanos = System.nanoTime() + config.shutdownDeadline().toNanos();
            while (dockerInspectRunning(containerName) && System.nanoTime() < deadlineNanos) {
                sleepQuietly(100);
            }
            if (dockerInspectRunning(containerName)) {
                docker("rm", "-f", containerName);
                throw new IllegalStateException(
                        "collector did not stop within " + config.shutdownDeadline() + "; forced cleanup performed");
            }
        }

        private boolean healthResponds(HttpClient client) {
            try {
                HttpRequest request = HttpRequest.newBuilder(HEALTH_URI)
                        .timeout(Duration.ofSeconds(2))
                        .GET()
                        .build();
                HttpResponse<Void> response = client.send(request, HttpResponse.BodyHandlers.discarding());
                return response.statusCode() == 200;
            } catch (IOException | InterruptedException e) {
                if (e instanceof InterruptedException) {
                    Thread.currentThread().interrupt();
                }
                return false;
            }
        }

        private static void sleepQuietly(long millis) {
            try {
                TimeUnit.MILLISECONDS.sleep(millis);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("interrupted while managing the collector runtime", e);
            }
        }

        private static void docker(String... args) {
            List<String> command = new java.util.ArrayList<>(List.of("docker"));
            command.addAll(List.of(args));
            try {
                Process run = new ProcessBuilder(command)
                        .redirectErrorStream(true)
                        .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                        .start();
                run.waitFor();
            } catch (IOException e) {
                throw new UncheckedIOException("docker " + args[0] + " failed: " + e.getMessage(), e);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("interrupted during docker " + args[0], e);
            }
        }

        private static boolean dockerInspectRunning(String name) {
            try {
                Process inspect = new ProcessBuilder("docker", "inspect", "-f", "{{.State.Running}}", name)
                        .redirectErrorStream(true)
                        .start();
                String output = new String(inspect.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
                inspect.waitFor();
                return "true".equals(output);
            } catch (IOException e) {
                return false;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
    }
}
