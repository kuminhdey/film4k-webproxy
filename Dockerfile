# Stage 1: Build Frontend (React 19 + TypeScript + Vite)
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Backend (Rust Axum Tokio)
FROM rust:bookworm AS backend-builder
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend

# Cache dependencies
COPY backend/Cargo.toml backend/Cargo.lock* ./
RUN mkdir -p src && echo "fn main() {}" > src/main.rs && echo "" > src/lib.rs && cargo build --release && rm -rf src

# Copy backend source
COPY backend/src ./src
COPY backend/tests ./tests
RUN touch src/main.rs src/lib.rs && cargo build --release

# Stage 3: Lightweight Production Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libssl3 \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy binary, static SPA assets, and seed database
COPY --from=backend-builder /app/backend/target/release/webproxy_backend /app/webproxy_backend
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
COPY film4k_master_database.json /app/film4k_master_database.json

# Environment variables
ENV HOST=0.0.0.0 \
    PORT=8090 \
    DATABASE_PATH=/app/movies.db \
    RUST_LOG=info

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD curl -f http://127.0.0.1:8090/api/health || exit 1

CMD ["/app/webproxy_backend"]
