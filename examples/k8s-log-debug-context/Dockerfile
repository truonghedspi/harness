FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 --no-create-home app
WORKDIR /app
COPY target/k8s-log-debug-context-0.1.0-SNAPSHOT.jar /app/service.jar
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/service.jar"]
