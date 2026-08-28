package io.harness.logcontext.ingest;

import java.util.List;
import java.util.Objects;
import java.util.Set;

public record IngestPolicy(Set<String> allowedEnvironments, List<String> redactionLiterals) {
  public IngestPolicy {
    allowedEnvironments = Set.copyOf(Objects.requireNonNull(allowedEnvironments));
    redactionLiterals = List.copyOf(Objects.requireNonNull(redactionLiterals));
    if (allowedEnvironments.stream().anyMatch(value -> value == null || value.isBlank())) {
      throw new IllegalArgumentException("allowed environments must be non-blank");
    }
    if (redactionLiterals.stream().anyMatch(value -> value == null || value.isEmpty())) {
      throw new IllegalArgumentException("redaction literals must be non-empty");
    }
  }
}
