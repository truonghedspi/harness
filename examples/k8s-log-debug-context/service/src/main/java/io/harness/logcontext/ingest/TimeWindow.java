package io.harness.logcontext.ingest;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;

public record TimeWindow(Instant fromInclusive, Instant toExclusive) {
  public TimeWindow {
    Objects.requireNonNull(fromInclusive);
    Objects.requireNonNull(toExclusive);
    if (!toExclusive.isAfter(fromInclusive)) {
      throw new IllegalArgumentException("time window must be non-empty");
    }
    if (Duration.between(fromInclusive, toExclusive).compareTo(Duration.ofMinutes(15)) > 0) {
      throw new IllegalArgumentException("time window exceeds 15 minutes");
    }
  }
}
