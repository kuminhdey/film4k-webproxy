# Film4K Webproxy — Production Operations Runbook

**Audience:** Site Reliability Engineers, Ops Engineers, Release Managers  
**Baseline Git Commit:** `2648f8043d0c61b6253761e0b24bccf7f7d5d130`  
**Related Findings:** #15 (Safe Backup & Rehearsal), #16 (Immutable Provenance & Base Pinning), #17 (CI & Alerts), #18 (Ops Documentation)

---

## 1. System Topology & Architecture

The Film4K Webproxy service runs as a unified containerized application bundling an Axum/Tokio Rust streaming backend with a compiled React 19 SPA frontend and an embedded SQLite database.

```
                  +-----------------------------------+
                  |          Reverse Proxy            |
                  |     (Nginx / Caddy / Cloudflare)  |
                  +-----------------+-----------------+
                                    | (TLS Termination)
                                    v
                  +-----------------------------------+
                  |    Host Loopback Interface        |
                  |       127.0.0.1:8090              |
                  +-----------------+-----------------+
                                    |
                                    v
+-----------------------------------------------------------------+
| Container: film4k-webproxy                                      |
|                                                                 |
|   +---------------------------------------------------------+   |
|   | Process: /app/webproxy_backend (Port 8090)              |   |
|   | - SPA Static File Server (React 19 / Vite at /app/dist) |   |
|   | - API & Streaming Proxy Engine                          |   |
|   | - SQLite WAL Engine (/app/data/movies.db)               |   |
|   +----------------------------+----------------------------+   |
|                                |                                |
|   +----------------------------v----------------------------+   |
|   | Mounted Volume: ./data -> /app/data                     |   |
|   | - movies.db, movies.db-wal, movies.db-shm               |   |
|   | - backups/ (latest.bak, previous.bak, timestamped)      |   |
|   +---------------------------------------------------------+   |
|                                                                 |
|   +---------------------------------------------------------+   |
|   | Baked Ops Tooling: /app/scripts/*.sh                    |   |
|   | - backup_sqlite.sh, restore_rehearsal.sh                |   |
|   +---------------------------------------------------------+   |
+-----------------------------------------------------------------+
```

### 1.1 Ports and Bindings
- **Container Port:** `8090` (configured via `PORT=8090`, `HOST=0.0.0.0`).
- **Host Binding:** `127.0.0.1:8090:8090` in `docker-compose.yml`.
  > [!IMPORTANT]
  > Never bind `0.0.0.0:8090` directly on a public interface without reverse proxy authentication, rate limiting, and TLS termination.

### 1.2 Storage & Database Topology
- **Host Directory:** `./data/`
- **Container Mount:** `/app/data/`
- **Database Path:** `/app/data/movies.db`
- **Journal Mode:** SQLite WAL (Write-Ahead Logging). During runtime, `movies.db-wal` and `movies.db-shm` are active. Direct file copying of `movies.db` without `VACUUM INTO` or the SQLite Online Backup API can result in corrupted backups.

---

## 2. Safe Online SQLite Backup Runbook (#15)

### 2.1 Online Backup Principles
1. **Concurrency Safety:** Uses SQLite `VACUUM INTO` (with automated fallback to `.backup` API). This acquires a clean, point-in-time snapshot of the database while concurrent read/write queries continue without long table locks.
2. **Integrity Validation:** Before promoting any backup, the script runs `PRAGMA integrity_check`, `PRAGMA quick_check`, and `PRAGMA foreign_key_check`. Corrupted candidate files are immediately aborted and cleaned up.
3. **Crash-Resistant Atomic Replacement:**
   - Previous backup preservation: Staged to a temporary file in the same directory and atomically renamed to `movies.db.previous.bak`.
   - Candidate backup: Promoted to an immutable timestamped file with a collision-proof unique suffix (`movies.db.<timestamp>_<hex>.bak`).
   - Latest pointer: Staged in the same directory and atomically renamed to `movies.db.latest.bak`.
   - Result: No crash or power cut can truncate or corrupt the prior backup.
4. **Rolling Retention:** Automatically retains the configured number of historical backups (default 7) while never deleting `latest.bak` or `previous.bak`.

### 2.2 Execution Methods

#### Method A: Inside Container (Standard Production Deployment)
Most production hosts do **not** have the `sqlite3` CLI tool installed. The image bundles `sqlite3` and the backup scripts in `/app/scripts/`.

Run the backup inside the live container:
```bash
docker compose exec -T film4k-webproxy /app/scripts/backup_sqlite.sh \
  --db /app/data/movies.db \
  --backup-dir /app/data/backups
```

Or via direct Docker CLI:
```bash
docker exec -i film4k-webproxy /app/scripts/backup_sqlite.sh \
  --db /app/data/movies.db \
  --backup-dir /app/data/backups
```

#### Method B: On Host (If sqlite3 CLI is installed on host)
```bash
./scripts/backup_sqlite.sh \
  --db ./data/movies.db \
  --backup-dir ./data/backups
```

### 2.3 Automated Backup Scheduling

#### Via Host Crontab
Add the following job to the host's crontab (`crontab -e`) to take backups every 6 hours:
```cron
0 */6 * * * cd /opt/webproxy && docker compose exec -T film4k-webproxy /app/scripts/backup_sqlite.sh --db /app/data/movies.db --backup-dir /app/data/backups --quiet >> /var/log/webproxy_backup.log 2>&1
```

#### Via Systemd Timer
1. Service unit `/etc/systemd/system/webproxy-backup.service`:
   ```ini
   [Unit]
   Description=Film4K Webproxy Online SQLite Backup
   Requires=docker.service
   After=docker.service

   [Service]
   Type=oneshot
   WorkingDirectory=/opt/webproxy
   ExecStart=/usr/bin/docker compose exec -T film4k-webproxy /app/scripts/backup_sqlite.sh --db /app/data/movies.db --backup-dir /app/data/backups --quiet
   ```
2. Timer unit `/etc/systemd/system/webproxy-backup.timer`:
   ```ini
   [Unit]
   Description=Run Film4K Webproxy SQLite Backup every 6 hours

   [Timer]
   OnCalendar=*-*-* 00,06,12,18:00:00
   Persistent=true

   [Install]
   WantedBy=timers.target
   ```
3. Enable timer: `systemctl enable --now webproxy-backup.timer`

---

## 3. Isolated Restore Rehearsal Runbook (#15)

### 3.1 Purpose & Safety Guarantees
- Performs full disaster recovery verification on candidate backup files.
- Operates entirely inside an ephemeral scratch directory (`mktemp -d`).
- **Production Isolation:** The live database path is completely decoupled; no write descriptors are opened against the live database.
  > [!NOTE]
  > In an active WAL SQLite database, ongoing background crawler and stream token refresh activity continuously updates `movies.db-wal` and checkpoints into `movies.db`. Therefore, live DB mtime/size changes are normal and expected; isolation is guaranteed by strict filesystem sandbox separation.

### 3.2 Running the Rehearsal

#### Inside Container:
```bash
docker compose exec -T film4k-webproxy /app/scripts/restore_rehearsal.sh \
  --file /app/data/backups/movies.db.latest.bak \
  --live-db /app/data/movies.db
```

#### On Host:
```bash
./scripts/restore_rehearsal.sh \
  --file ./data/backups/movies.db.latest.bak \
  --live-db ./data/movies.db
```

### 3.3 Interpreting the Report
A successful rehearsal emits:
```
============================================================
           RESTORE REHEARSAL VERIFICATION REPORT
============================================================
Timestamp:             2026-10-28T12:07:09Z
Target Backup:         /app/data/backups/movies.db.latest.bak
Backup Size:           20480 bytes
Backup SHA256:         72a03706a9f21b8d2f2da3fff0c80c8da0422998338610411fea42d1c8c75424
Sandbox Path:          /tmp/webproxy_restore_rehearsal_XXXXXX
Integrity Check:       PASSED (ok)
Quick Check:           PASSED (ok)
Table Count:           2
Read/Write Sanity:     PASSED
Production Isolation:  PASSED (isolated scratch directory, zero writes to live DB)
Verdict:               PASSED / READY FOR PRODUCTION RESTORE
============================================================
```

---

## 4. Immutable Build & Commit Provenance Runbook (#16)

### 4.1 Build-Time Contract
Every production container image must be built with an explicit, non-empty `BUILD_COMMIT` argument matching the git commit SHA:

```bash
export BUILD_COMMIT=$(git rev-parse HEAD)
export IMAGE_TAG=$(git rev-parse --short=8 HEAD)
export ADMIN_PASSWORD="your-strong-production-admin-password"
export TRUSTED_PROXIES="172.21.0.1" # Verify the current Docker gateway before each deploy.

docker compose build --build-arg BUILD_COMMIT="${BUILD_COMMIT}"
docker compose up -d
```

### 4.2 Why Defaults are Enforced with Error Guards
In `docker-compose.yml`, parameters use `${VARIABLE:?error_message}`:
- `${BUILD_COMMIT:?...}`
- `${IMAGE_TAG:?...}`
- `${ADMIN_PASSWORD:?...}`

If any variable is omitted in the environment, Docker Compose immediately halts rather than falling back to stale commit hashes or unauthenticated default passwords.

### 4.3 Verifying Deployment with Zero Drift
Query the running service to verify that the compiled binary commit matches the deployed container tag:

```bash
curl -s http://127.0.0.1:8090/health/ready | jq .
```
Expected output:
```json
{
  "status": "ready",
  "ready": true,
  "migrations_applied": 4,
  "commit": "2648f8043d0c61b6253761e0b24bccf7f7d5d130"
}
```

---

## 5. Rollback & Disaster Recovery Runbook

### 5.1 Service Image Rollback
If a newly deployed image exhibits application regressions, roll back to the previous immutable image tag:

```bash
# 1. Inspect available local or registry tags
docker images film4k-webproxy

# 2. Re-point environment to previous commit tag
export IMAGE_TAG="<previous-commit-short-sha>"
export BUILD_COMMIT="<previous-commit-full-sha>"

# 3. Re-launch container
docker compose up -d --no-build
```

### 5.2 Database Restoration
If the live database experiences corruption:

```bash
# 1. Stop the webproxy container to release WAL locks
docker compose stop film4k-webproxy

# 2. Archive the corrupted database for post-mortem forensics
mv ./data/movies.db ./data/movies.db.corrupt_$(date +%s)
rm -f ./data/movies.db-wal ./data/movies.db-shm

# 3. Restore from the latest verified backup
cp -p ./data/backups/movies.db.latest.bak ./data/movies.db

# 4. Verify integrity before restarting
sqlite3 ./data/movies.db "PRAGMA integrity_check;"

# 5. Restart service
docker compose start film4k-webproxy

# 6. Verify health and readiness
curl -sf http://127.0.0.1:8090/health/ready | jq .
```

---

## 6. CI Pipeline & External Alerting Limits (#17)

### 6.1 Continuous Integration Architecture
The GitHub Actions workflow (`.github/workflows/ci.yml`) enforces the following gates on every push and pull request:
1. `backend-verification`: `cargo check --locked` and `cargo test --locked` using Rust 1.88.0.
2. `frontend-verification`: `npm ci --no-audit --no-fund` and `npm run build` using Node.js 22.x.
3. `ops-scripts-verification`: Automated test suite (`scripts/test_ops_scripts.sh`) validating backup, atomic rotation, failure aborts, and rehearsal isolation.
4. `docker-image-smoke`:
   - Builds container image with `BUILD_COMMIT=${{ github.sha }}`.
   - Launches container with loopback port 8090 and required environment variables.
   - Asserts `/api/health` returns HTTP 200.
   - Asserts `/health/ready` returns HTTP 200 and `.commit` matches `${{ github.sha }}` (fails if absent or mismatched).
   - Executes in-container backup and restore rehearsal scripts.
   - Asserts SPA HTML delivery.
   - Audits container logs to confirm zero leaked secrets (`ADMIN_PASSWORD`).
5. `ci-failure-alerts`: Writes GitHub Step Summary and dispatches webhook alert if `secrets.ALERT_WEBHOOK_URL` is configured.

### 6.2 In-Repo Alerts vs External Alert Limits
- **Repo-Configurable:**
  - GitHub Actions Step Summary table.
  - Optional webhook dispatch using a Slack-compatible JSON `{ "text": "..." }` endpoint via repository secret `ALERT_WEBHOOK_URL`.
- **Host runtime alerts:** `ops/systemd/webproxy-runtime-alerts.timer` runs a local readiness and crawler-freshness check every five minutes. It alerts when `/health/ready` is not ready, the crawler has not completed a run for 26 hours, or no completed crawler run appears within the initial two-hour grace period. It sends one alert per issue and retries failed or unconfigured deliveries.
  1. Create `/etc/webproxy-runtime-alerts.env` on `oci-sg-2` with `ALERT_WEBHOOK_URL=<Slack-compatible webhook URL>` using a secure editor; set mode `0600` and do not put the URL in shell history, command arguments, or logs.
  2. Copy the checked-out release's `scripts/runtime_alert_monitor.py`, `scripts/install_runtime_alerts.sh`, and `ops/systemd/` files to the host, then run `sudo bash scripts/install_runtime_alerts.sh` from the release checkout.
  3. Verify with `systemctl list-timers webproxy-runtime-alerts.timer`, `systemctl status webproxy-runtime-alerts.service`, and `journalctl -u webproxy-runtime-alerts.service`. A healthy check confirms local monitoring only; verify actual webhook receipt before declaring alert delivery operational.
  4. To update the webhook endpoint later, edit the root-only environment file and run `sudo systemctl start webproxy-runtime-alerts.service` to test delivery.
- **Remaining External Monitoring Limits:**
  1. **Blackbox / Synthetic Uptime Probes:** If the host machine loses network connectivity, the Docker daemon crashes, or the server loses power, internal container healthchecks and GitHub Actions cannot fire alerts. An external monitoring probe (e.g. UptimeRobot, Datadog Synthetic, BetterStack, or Prometheus Blackbox Exporter) must ping `http://<your-host>:8090/health/live` every 60 seconds.
  2. **Crawler Lag & Scheduler Heartbeats:** The host timer monitors the crawler's last completed run, but it does not confirm that newly crawled data is semantically correct. If upstream API structures change, also monitor ingestion results and data freshness.
  3. **Repository Secret Ingestion:** The CI notification step degrades gracefully to native GitHub notifications if `ALERT_WEBHOOK_URL` is omitted. SREs must configure this secret in GitHub repo settings (`Settings -> Secrets and variables -> Actions`) to enable real-time chat alerts.
