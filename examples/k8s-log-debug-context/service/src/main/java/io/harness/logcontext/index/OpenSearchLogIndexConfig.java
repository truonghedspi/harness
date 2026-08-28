package io.harness.logcontext.index;

import java.time.Clock;
import java.util.Objects;

public record OpenSearchLogIndexConfig(String indexPrefix, Clock clock) {
  public OpenSearchLogIndexConfig {
    Objects.requireNonNull(indexPrefix);
    Objects.requireNonNull(clock);
  }
}
