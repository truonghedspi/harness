#!/usr/bin/env bash
# init.sh — the baseline gate. Run at the start AND end of every session (Lesson 6/9/12).
# Green = the standard startup path works and verification passes. A loop must never run on red.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "=== Harness init: {{PROJECT_NAME}} ==="

# Observability (Lesson 11): ensure the trace sink exists and record this run.
mkdir -p trace
if [ -f tools/trace.mjs ] && command -v node >/dev/null 2>&1; then
  node tools/trace.mjs init session-start "./init.sh" || true
fi

# Keep the always-loaded feature digest in step with the source of truth (docs/reference/
# llm-failure-modes.md: the full list dominates every agent's context, the digest is what they read).
if [ -f tools/feature-digest.mjs ]; then node tools/feature-digest.mjs --target . >/dev/null || true; fi

# >>> VERIFICATION  (the scaffolder replaces this block when --commands is given)
if [ -f package.json ]; then
  if [ -f pnpm-lock.yaml ]; then PM="pnpm";
  elif [ -f yarn.lock ]; then PM="yarn";
  elif [ -f bun.lockb ] || [ -f bun.lock ]; then PM="bun";
  else PM="npm"; fi
  echo "=== Installing dependencies with $PM ==="
  if [ "$PM" = "npm" ]; then npm install; else "$PM" install; fi
  run() { if [ "$PM" = "npm" ]; then npm run "$1"; else "$PM" run "$1"; fi; }
  has() { node -e "const s=require('./package.json').scripts||{};process.exit(s['$1']?0:1)"; }
  has check     && { echo '=== check ==='     ; run check; }     || true
  has typecheck && { echo '=== typecheck ===' ; run typecheck; } || true
  has lint      && { echo '=== lint ==='      ; run lint; }      || true
  has build     && { echo '=== build ==='     ; run build; }     || true
  has test      && { echo '=== test ==='      ; if [ "$PM" = "npm" ]; then npm test; else "$PM" test; fi; } || true
elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then
  echo "=== Python verification ==="
  PY="$(command -v python3 || command -v python)"
  "$PY" -m pytest || [ $? -eq 5 ]  # exit 5 = no tests collected, not a failure for a fresh project
  "$PY" -m compileall -q -x '(^|/)(\.?venv|env|node_modules|build|dist|__pycache__)(/|$)' .
elif [ -f go.mod ]; then
  echo "=== Go verification ==="; go build ./... && go test ./...
elif [ -f Cargo.toml ]; then
  echo "=== Rust verification ==="; cargo build && cargo test
elif [ -f pom.xml ]; then
  echo "=== Maven verification ==="
  if [ -x ./mvnw ]; then ./mvnw -q verify; else mvn -q verify; fi
elif [ -f build.gradle ] || [ -f build.gradle.kts ]; then
  echo "=== Gradle verification ==="
  if [ -x ./gradlew ]; then ./gradlew build test; else gradle build test; fi
elif ls ./*.csproj ./*.sln >/dev/null 2>&1; then
  echo "=== .NET verification ==="; dotnet build && dotnet test
else
  echo "No recognized manifest. Edit this VERIFICATION block with the project's build/test commands." >&2
  exit 1
fi
# <<< VERIFICATION

echo "=== Baseline green ==="
echo ""
echo "Next: read feature_list.json, pick ONE eligible feature, advance it, re-verify before 'done'."
