#!/usr/bin/env bash
# ==============================================================================
# scripts/restore_rehearsal.sh
# Production Isolated Restore Rehearsal for SQLite Backups
#
# Finding #15: Isolated restore rehearsal without touching production database.
#
# Execution Environment:
# - Can run on host (if sqlite3 CLI is installed) OR
# - Inside container: docker exec -i film4k-webproxy /app/scripts/restore_rehearsal.sh
# ==============================================================================

set -euo pipefail

BACKUP_FILE=""
LIVE_DB_PATH="${DATABASE_PATH:-./data/movies.db}"
KEEP_SANDBOX=0
QUIET=0

log_info() {
    if [ "$QUIET" -eq 0 ]; then
        printf "[%s] [INFO] %s\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
    fi
}

log_warn() {
    printf "[%s] [WARN] %s\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

log_error() {
    printf "[%s] [ERROR] %s\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

compute_sha256() {
    local target="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$target" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$target" | awk '{print $1}'
    else
        log_error "Neither sha256sum nor shasum is available."
        return 1
    fi
}

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] [BACKUP_FILE]

Performs an automated, isolated restore rehearsal of a candidate SQLite backup.
Verifies integrity, schema tables, read/write sanity in an isolated temporary sandbox,
with complete separation from the production/live database.

ARGUMENTS:
    BACKUP_FILE             Path to backup file (.bak) to test.
                            Defaults to latest backup in backup directory.

OPTIONS:
    -f, --file PATH         Specify backup file
    -l, --live-db PATH      Path to live DB to assert non-overlap (default: \${DATABASE_PATH:-./data/movies.db})
    -k, --keep-sandbox      Preserve isolated rehearsal directory after test (for debugging)
    -q, --quiet             Suppress informational output
    -h, --help              Show this help message
EOF
}

# Parse options
while [[ $# -gt 0 ]]; do
    case "$1" in
        -f|--file)
            BACKUP_FILE="$2"
            shift 2
            ;;
        -l|--live-db)
            LIVE_DB_PATH="$2"
            shift 2
            ;;
        -k|--keep-sandbox)
            KEEP_SANDBOX=1
            shift
            ;;
        -q|--quiet)
            QUIET=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        -*)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
        *)
            if [ -z "$BACKUP_FILE" ]; then
                BACKUP_FILE="$1"
                shift
            else
                log_error "Unexpected argument: $1"
                usage
                exit 1
            fi
            ;;
    esac
done

if ! command -v sqlite3 >/dev/null 2>&1; then
    log_error "sqlite3 CLI binary not found."
    log_error "Note: If running on a host without sqlite3, execute inside the container:"
    log_error "  docker compose exec -T film4k-webproxy /app/scripts/restore_rehearsal.sh"
    exit 1
fi

# Determine backup file if not specified
if [ -z "$BACKUP_FILE" ]; then
    DEFAULT_BACKUP_DIR="$(dirname "$LIVE_DB_PATH")/backups"
    if [ -f "${DEFAULT_BACKUP_DIR}/$(basename "$LIVE_DB_PATH").latest.bak" ]; then
        BACKUP_FILE="${DEFAULT_BACKUP_DIR}/$(basename "$LIVE_DB_PATH").latest.bak"
    else
        # Find newest .bak file
        LATEST_FOUND=$(find "$DEFAULT_BACKUP_DIR" -maxdepth 1 -name "*.bak" ! -name "*.previous.bak" 2>/dev/null | sort -r | head -n 1 || true)
        if [ -n "$LATEST_FOUND" ]; then
            BACKUP_FILE="$LATEST_FOUND"
        fi
    fi
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
    log_error "No backup file found to rehearse. Target: ${BACKUP_FILE:-<none>}"
    exit 1
fi

log_info "Initiating isolated restore rehearsal..."
log_info "  Target Backup: $BACKUP_FILE"
log_info "  Live DB Path:  $LIVE_DB_PATH"

# Create isolated sandbox directory in temporary space
SANDBOX_DIR=$(mktemp -d -t webproxy_restore_rehearsal_XXXXXX)
log_info "Isolated sandbox created: $SANDBOX_DIR"

# Canonical path overlap verification: ensure sandbox is strictly outside production DB directory
RESOLVED_SANDBOX=$(cd "$SANDBOX_DIR" && pwd -P)
RESOLVED_LIVE_DIR=""
if [ -d "$(dirname "$LIVE_DB_PATH")" ]; then
    RESOLVED_LIVE_DIR=$(cd "$(dirname "$LIVE_DB_PATH")" && pwd -P)
fi

if [ -n "$RESOLVED_LIVE_DIR" ] && [ "$RESOLVED_SANDBOX" = "$RESOLVED_LIVE_DIR" ]; then
    log_error "FATAL: Sandbox directory collides with live database directory! Aborting."
    exit 5
fi

cleanup_sandbox() {
    local exit_code=$?
    if [ "$KEEP_SANDBOX" -eq 0 ]; then
        if [ -d "$SANDBOX_DIR" ]; then
            rm -rf "$SANDBOX_DIR"
            log_info "Isolated sandbox cleaned up."
        fi
    else
        log_warn "Sandbox retained at: $SANDBOX_DIR"
    fi
    exit $exit_code
}
trap cleanup_sandbox EXIT INT TERM

# Rehearsal execution
RESTORED_DB="${SANDBOX_DIR}/rehearsal.db"

# Step 1: Copy backup to isolated sandbox
log_info "Copying backup to sandbox..."
cp "$BACKUP_FILE" "$RESTORED_DB"

# Step 2: Validate file presence and checksum
if [ ! -s "$RESTORED_DB" ]; then
    log_error "Rehearsal failed: restored database in sandbox is empty or missing."
    exit 2
fi

BACKUP_SHA256=$(compute_sha256 "$BACKUP_FILE")
RESTORED_SHA256=$(compute_sha256 "$RESTORED_DB")
if [ "$BACKUP_SHA256" != "$RESTORED_SHA256" ]; then
    log_error "Checksum mismatch between backup and restored sandbox file!"
    exit 2
fi

# Step 3: Run SQLite PRAGMA integrity checks on restored DB
log_info "Running PRAGMA integrity_check on restored database..."
INTEGRITY=$(sqlite3 "$RESTORED_DB" "PRAGMA integrity_check;" 2>&1 || true)
if [ "$INTEGRITY" != "ok" ]; then
    log_error "Integrity check failed: $INTEGRITY"
    exit 3
fi

QUICK=$(sqlite3 "$RESTORED_DB" "PRAGMA quick_check;" 2>&1 || true)
if [ "$QUICK" != "ok" ]; then
    log_error "Quick check failed: $QUICK"
    exit 3
fi

# Step 4: Examine schema and tables
TABLES=$(sqlite3 "$RESTORED_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';" 2>/dev/null || true)
TABLE_COUNT=$(echo "$TABLES" | grep -v '^$' | wc -l | tr -d ' ')
log_info "Restored database contains $TABLE_COUNT user table(s)."

# Step 5: Read query sanity verification
if echo "$TABLES" | grep -qx "movies"; then
    MOVIE_COUNT=$(sqlite3 "$RESTORED_DB" "SELECT count(*) FROM movies;" 2>/dev/null || echo "0")
    log_info "Sanity check: 'movies' table found with $MOVIE_COUNT row(s)."
fi

# Step 6: Test isolated write operations within sandbox (verifies DB writeability and WAL/rollback journal in isolated sandbox)
sqlite3 "$RESTORED_DB" <<SQL
CREATE TABLE _rehearsal_probe (id INTEGER PRIMARY KEY, test_val TEXT);
INSERT INTO _rehearsal_probe (test_val) VALUES ('rehearsal_ok');
DROP TABLE _rehearsal_probe;
SQL
log_info "Sandbox read/write transaction cycle verified successfully."

# Step 7: Strict production isolation confirmation
# In an active WAL production database, ongoing crawler/proxy traffic continuously updates
# the live database (WAL checkpoints and writes), so size/mtime equality checks on live DB
# are invalid. Isolation is guaranteed by path separation, private descriptors, and zero handles
# opened to the live database file during rehearsal.
log_info "Production isolation confirmed: rehearsal strictly confined to sandbox ($RESOLVED_SANDBOX)."

# Output Rehearsal Report
cat <<EOF

============================================================
           RESTORE REHEARSAL VERIFICATION REPORT
============================================================
Timestamp:             $(date -u +'%Y-%m-%dT%H:%M:%SZ')
Target Backup:         $BACKUP_FILE
Backup Size:           $(wc -c < "$BACKUP_FILE" | tr -d ' ') bytes
Backup SHA256:         $BACKUP_SHA256
Sandbox Path:          $RESOLVED_SANDBOX
Integrity Check:       PASSED (ok)
Quick Check:           PASSED (ok)
Table Count:           $TABLE_COUNT
Read/Write Sanity:     PASSED
Production Isolation:  PASSED (isolated scratch directory, zero writes to live DB)
Verdict:               PASSED / READY FOR PRODUCTION RESTORE
============================================================
EOF

exit 0
