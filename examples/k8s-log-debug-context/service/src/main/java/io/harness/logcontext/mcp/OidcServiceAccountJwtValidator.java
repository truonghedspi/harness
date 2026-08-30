package io.harness.logcontext.mcp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.RSAPublicKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

/** Local RS256 validation against JWKS refreshed with the service's projected Kubernetes token. */
public final class OidcServiceAccountJwtValidator implements ServiceAccountJwtValidator {
  private static final ObjectMapper JSON = new ObjectMapper();
  private final URI jwksUri;
  private final String issuer;
  private final String audience;
  private final Path serviceAccountToken;
  private final HttpClient http;
  private volatile Map<String, java.security.PublicKey> keys = Map.of();
  private volatile Instant refreshAfter = Instant.EPOCH;

  public OidcServiceAccountJwtValidator(
      URI jwksUri, String issuer, String audience, Path ca, Path serviceAccountToken) {
    this.jwksUri = jwksUri;
    this.issuer = issuer;
    this.audience = audience;
    this.serviceAccountToken = serviceAccountToken;
    this.http = HttpClient.newBuilder().sslContext(sslContext(ca)).connectTimeout(Duration.ofSeconds(3)).build();
  }

  @Override
  public JwtValidation validate(Optional<String> bearerToken) {
    try {
      if (bearerToken.isEmpty()) return invalid("missing-bearer");
      String[] parts = bearerToken.orElseThrow().split("\\.");
      if (parts.length != 3) return invalid("malformed-token");
      JsonNode header = decode(parts[0]);
      JsonNode claims = decode(parts[1]);
      if (!"RS256".equals(header.path("alg").asText())) return invalid("unsupported-algorithm");
      if (!issuer.equals(claims.path("iss").asText())) return invalid("issuer-mismatch");
      long now = Instant.now().getEpochSecond();
      if (claims.path("exp").asLong(0) <= now || claims.path("nbf").asLong(0) > now) {
        return invalid("token-time-window");
      }
      JsonNode aud = claims.path("aud");
      boolean audienceMatches = aud.isTextual() ? audience.equals(aud.asText())
          : aud.isArray() && java.util.stream.StreamSupport.stream(aud.spliterator(), false)
              .anyMatch(value -> audience.equals(value.asText()));
      if (!audienceMatches) return invalid("audience-mismatch");
      if (!claims.path("sub").asText("").startsWith("system:serviceaccount:")) {
        return invalid("subject-mismatch");
      }
      String kid = header.path("kid").asText();
      java.security.PublicKey key = signingKeys().get(kid);
      if (key == null) return invalid("signing-key-missing");
      Signature signature = Signature.getInstance("SHA256withRSA");
      signature.initVerify(key);
      signature.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
      return signature.verify(Base64.getUrlDecoder().decode(parts[2]))
          ? new JwtValidation.Valid() : invalid("signature-mismatch");
    } catch (Exception invalid) {
      return invalid("validation-error-" + invalid.getClass().getSimpleName());
    }
  }

  private static JwtValidation.Invalid invalid(String reason) {
    System.err.println("MCP_JWT_INVALID: " + reason);
    return new JwtValidation.Invalid();
  }

  private synchronized Map<String, java.security.PublicKey> signingKeys() throws Exception {
    if (Instant.now().isBefore(refreshAfter) && !keys.isEmpty()) return keys;
    String projectedToken = Files.readString(serviceAccountToken).trim();
    if (projectedToken.isEmpty()) throw new IllegalStateException("projected ServiceAccount token is empty");
    HttpRequest request = HttpRequest.newBuilder(jwksUri).timeout(Duration.ofSeconds(5))
        .header("Authorization", "Bearer " + projectedToken).GET().build();
    HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() / 100 != 2) throw new IllegalStateException("JWKS HTTP " + response.statusCode());
    Map<String, java.security.PublicKey> refreshed = new HashMap<>();
    for (JsonNode jwk : JSON.readTree(response.body()).path("keys")) {
      if (!"RSA".equals(jwk.path("kty").asText())) continue;
      BigInteger modulus = new BigInteger(1, Base64.getUrlDecoder().decode(jwk.path("n").asText()));
      BigInteger exponent = new BigInteger(1, Base64.getUrlDecoder().decode(jwk.path("e").asText()));
      refreshed.put(jwk.path("kid").asText(), KeyFactory.getInstance("RSA")
          .generatePublic(new RSAPublicKeySpec(modulus, exponent)));
    }
    keys = Map.copyOf(refreshed);
    refreshAfter = Instant.now().plus(Duration.ofMinutes(5));
    return keys;
  }

  private static JsonNode decode(String part) throws Exception {
    return JSON.readTree(Base64.getUrlDecoder().decode(part));
  }

  private static SSLContext sslContext(Path ca) {
    try {
      X509Certificate certificate;
      try (var input = Files.newInputStream(ca)) {
        certificate = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(input);
      }
      var store = java.security.KeyStore.getInstance(java.security.KeyStore.getDefaultType());
      store.load(null);
      store.setCertificateEntry("kubernetes-ca", certificate);
      var trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
      trust.init(store);
      var context = SSLContext.getInstance("TLS");
      context.init(null, trust.getTrustManagers(), null);
      return context;
    } catch (Exception error) {
      throw new IllegalStateException("cannot initialize Kubernetes issuer trust", error);
    }
  }
}
