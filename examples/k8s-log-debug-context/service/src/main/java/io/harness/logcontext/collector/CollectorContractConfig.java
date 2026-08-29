package io.harness.logcontext.collector;

import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Objects;

/**
 * Configuration for the non-cluster collector contract launcher.
 *
 * @param ingestEndpoint the capture/ingest URI the collector exports to
 * @param fixtureDirectory the directory containing {@code pod-logs.json}, mounted read-only
 * @param readyDeadline the maximum time {@code awaitReady()} waits for the health endpoint
 * @param shutdownDeadline the maximum time {@code close()} waits before force-stopping the runtime
 */
public record CollectorContractConfig(URI ingestEndpoint, Path fixtureDirectory,
        Duration readyDeadline, Duration shutdownDeadline) {

    public CollectorContractConfig {
        Objects.requireNonNull(ingestEndpoint, "ingestEndpoint");
        Objects.requireNonNull(fixtureDirectory, "fixtureDirectory");
        Objects.requireNonNull(readyDeadline, "readyDeadline");
        Objects.requireNonNull(shutdownDeadline, "shutdownDeadline");
    }
}
