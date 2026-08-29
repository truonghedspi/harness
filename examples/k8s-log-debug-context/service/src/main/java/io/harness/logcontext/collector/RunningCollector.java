package io.harness.logcontext.collector;

/**
 * A started collector runtime. {@code awaitReady()} blocks until the collector health endpoint
 * responds within the configured readiness deadline; {@code close()} stops the runtime and, if it
 * does not stop within the shutdown deadline, force-stops it and reports the cleanup failure.
 */
public interface RunningCollector extends AutoCloseable {

    /** Blocks until the collector is ready or the configured readiness deadline elapses. */
    void awaitReady();

    @Override
    void close();
}
