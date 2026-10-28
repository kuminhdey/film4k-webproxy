# ==============================================================================
# Dockerfile - Film4K Webproxy Production Build
#
# Findings addressed:
# - #15: In-container ops scripts for safe online SQLite backup and restore rehearsal
# - #16: Pinned compatible builder/runtime bases, cargo --locked, required BUILD_COMMIT
#        build argument, immutable provenance labels and environment variables.
#
# Base Image Pinning Policy:
# Base images are pinned to specific stable distribution snapshots and toolchain
# releases (Node 22.14.0 Alpine 3.21, Rust 1.85.0 Bookworm, Debian Bookworm 20250224 slim).
# In multi-platform CI/CD registries, architecture-specific manifest digests (@sha256:...)
# can be appended where single-architecture pinning is required.
# ==============================================================================

# Stage 1: Build Frontend (React 19 + TypeScript + Vite)
FROM node:22.14.0-alpine3.21 AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Backend (Rust Axum Tokio)
FROM rust:1.85.0-bookworm AS backend-builder
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Cache dependencies with --locked
COPY Cargo.toml Cargo.lock ./
COPY backend/Cargo.toml ./backend/
RUN mkdir -p backend/src && echo "fn main() {}" > backend/src/main.rs && echo "" > backend/src/lib.rs && cargo build --locked --release -p webproxy_backend && rm -rf backend/src

# Immutable build provenance build-argument (strictly required and non-empty)
ARG BUILD_COMMIT
RUN if [ -z "$BUILD_COMMIT" ]; then echo "ERROR: BUILD_COMMIT build argument is required and cannot be empty!" >&2; exit 1; fi

# Copy backend source
COPY backend/src ./backend/src
COPY backend/tests ./backend/tests

# Pass BUILD_COMMIT into cargo build environment so option_env!("BUILD_COMMIT") compiles into binary
ENV BUILD_COMMIT=${BUILD_COMMIT}
RUN touch backend/src/main.rs backend/src/lib.rs && cargo build --locked --release -p webproxy_backend

# Stage 3: Lightweight Production Runtime
FROM debian:bookworm-20250224-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libssl3 \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Immutable provenance: receive BUILD_COMMIT in runtime stage for metadata and env
ARG BUILD_COMMIT
RUN if [ -z "$BUILD_COMMIT" ]; then echo "ERROR: BUILD_COMMIT build argument is required and cannot be empty!" >&2; exit 1; fi

LABEL org.opencontainers.image.title="film4k-webproxy" \
      org.opencontainers.image.description="Film4K Webproxy streaming backend and frontend service" \
      org.opencontainers.image.revision="${BUILD_COMMIT}"

# Copy binary, static SPA assets, seed database, and ops scripts
COPY --from=backend-builder /app/target/release/webproxy_backend /app/webproxy_backend
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
COPY film4k_master_database.json /app/film4k_master_database.json
COPY scripts /app/scripts
RUN chmod +x /app/scripts/*.sh

# Environment variables
ENV HOST=0.0.0.0 \
    PORT=8090 \
    DATABASE_PATH=/app/movies.db \
    RUST_LOG=info \
    BUILD_COMMIT=${BUILD_COMMIT}

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD curl -fsS http://127.0.0.1:8090/health/ready >/dev/null || exit 1

CMD ["/app/webproxy_backend"]
