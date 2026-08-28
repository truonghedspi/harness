package io.harness.logcontext.ingest;

import java.util.Objects;

public sealed interface IngestResult permits IngestResult.Accepted, IngestResult.Rejected {
  record Accepted() implements IngestResult {}

  record Rejected(String code) implements IngestResult {
    public Rejected {
      Objects.requireNonNull(code);
    }
  }
}
