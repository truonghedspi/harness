package io.harness.logcontext;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

final class BaselineTest {
  @Test
  @Timeout(5)
  void executesTheJava21TestSuite() {
    assertEquals(21, Runtime.version().feature() >= 21 ? 21 : Runtime.version().feature());
  }
}
