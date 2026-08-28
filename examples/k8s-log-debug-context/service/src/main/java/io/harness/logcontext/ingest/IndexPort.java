package io.harness.logcontext.ingest;

public interface IndexPort {
  void index(NormalizedLogRecord document);

  LogQueryResult search(LogQuery query);
}
