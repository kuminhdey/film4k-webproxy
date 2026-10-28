# Build & Readiness Coordination Contract

**Document Version:** 1.0.0  
**Target Commit:** `2648f8043d0c61b6253761e0b24bccf7f7d5d130`  
**Domain Owners:**
- **Release / Ops Worker:** `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `scripts/*`, `docs/*`
- **Backend Worker:** `backend/src/*`, `backend/tests/*`

---

## 1. Overview & Objectives

This document formalizes the immutable build provenance and readiness check contract between the backend implementation and release/operations infrastructure (addressing handoff findings **#14** and **#16**).

The objective is to eliminate configuration and deployment drift by ensuring that:
1. Every container image artifact has an immutable, non-forgeable git commit compiled directly into the binary.
2. The runtime service exposes its live readiness and compiled commit provenance via HTTP endpoints.
3. Automated CI smoke tests and orchestrators strictly verify that the running binary's reported commit matches the expected git commit SHA.

---

## 2. Coordination Contract Specification

### 2.1 Backend Contract (Rust / Axum)

1. **Compile-time Provenance Macro:**  
   The backend binary reads the build commit at compile-time using:
   ```rust
   let build_commit = option_env!("BUILD_COMMIT").unwrap_or("unknown");
   ```
   - In containerized and release builds, `BUILD_COMMIT` is guaranteed by the build harness.
   - In ad-hoc local development (e.g. `cargo run` without env vars), it safely defaults to `"unknown"`.

2. **Readiness Endpoints:**  
   The backend exposes readiness checks on two canonical routes:
   - `GET /health/ready`
   - `GET /api/health/ready`

3. **Response Schema:**
   - **HTTP 200 OK (Healthy & Ready):**
     ```json
     {
       "status": "ready",
       "ready": true,
       "migrations_applied": 4,
       "commit": "2648f8043d0c61b6253761e0b24bccf7f7d5d130"
     }
     ```
   - **HTTP 503 Service Unavailable (Unready / Degraded):**
     ```json
     {
       "status": "unhealthy",
       "ready": false,
       "reason": "Database connection or schema migration failure",
       "migrations_applied": 0
     }
     ```

4. **Liveness Endpoints:**  
   The backend also maintains low-overhead process liveness checks:
   - `GET /health/live` / `GET /api/health/live` returning HTTP 200 `{"status": "alive"}`
   - `GET /health` / `GET /api/health` returning HTTP 200 `"OK"` (or 503 degraded) for Docker / Compose healthcheck compatibility.

---

### 2.2 Release / Ops Contract (Docker, Compose & CI)

1. **Dockerfile Enforcement:**
   - `ARG BUILD_COMMIT` is declared in both `backend-builder` and runtime stages.
   - A build-time assertion enforces that `BUILD_COMMIT` is supplied and non-empty:
     ```dockerfile
     ARG BUILD_COMMIT
     RUN if [ -z "$BUILD_COMMIT" ]; then echo "ERROR: BUILD_COMMIT build argument is required and cannot be empty!" >&2; exit 1; fi
     ```
   - `ENV BUILD_COMMIT=${BUILD_COMMIT}` is set in the builder stage before running `cargo build --locked --release`, ensuring `option_env!("BUILD_COMMIT")` captures the exact git commit.
   - OCI Image Metadata is injected via standard labels:
     ```dockerfile
     LABEL org.opencontainers.image.revision="${BUILD_COMMIT}"
     ```
   - Base images are strictly pinned:
     - Frontend builder: `node:22.14.0-alpine3.21`
     - Backend builder: `rust:1.88.0-bookworm`
     - Runtime base: `debian:bookworm-20250224-slim`

2. **Docker Compose Contract:**
   - Builds pass `BUILD_COMMIT` as a build argument:
     ```yaml
     args:
      BUILD_COMMIT: "${BUILD_COMMIT:?BUILD_COMMIT is required}"
     ```
   - Service image is tagged with an immutable identifier rather than floating `latest`:
     ```yaml
    image: film4k-webproxy:${IMAGE_TAG:?IMAGE_TAG is required}
     ```

3. **CI Verification Gate:**
   - In `.github/workflows/ci.yml`, the `docker-image-smoke` job builds the image using `${{ github.sha }}`.
   - After starting the container, it queries `/health/ready` (or `/api/health/ready`) and extracts `.commit`.
   - The test asserts that `.commit` matches `${{ github.sha }}` (or its 8-character prefix). Any divergence causes immediate CI pipeline failure.

---

## 3. Boundary & Responsibility Matrix

| Area | Release/Ops Worker | Backend Worker |
|---|---|---|
| `backend/src/*` | **Do not edit** | **Owner** (implements `/health/ready`, reads `option_env!("BUILD_COMMIT")`) |
| `backend/tests/*` | **Do not edit** | **Owner** |
| `Dockerfile` | **Owner** (pins bases, passes `BUILD_COMMIT`, `--locked`) | **Do not edit** |
| `docker-compose.yml` | **Owner** (immutable tags, build args, healthcheck) | **Do not edit** |
| `.github/workflows/*` | **Owner** (CI jobs, commit assertion smoke test, alerts) | **Do not edit** |
| `scripts/*` | **Owner** (backup, restore rehearsal, test harness) | **Do not edit** |
| `docs/*` | **Owner** (runbook, coordination contracts) | **Do not edit** |
