#!/usr/bin/env bash
# ==============================================================================
# scripts/backup_sqlite.sh
# Production Online Safe SQLite Backup with Integrity Check & Atomic Rotation
#
# Finding #15: Safe online SQLite backup with integrity check and atomic
# replacement without losing old backup.
#
# Execution Environment:
# - Can run on host (if sqlite3 CLI is installed) OR
# - Inside container: docker exec -i film4k-webproxy /app/scripts/backup_sqlite.sh
# ==============================================================================

set -euo pipefail

# Default configuration
DEFAULT_DB_PATH="${DATABASE_PATH:-./data/movies.db}"
DB_PATH="${DEFAULT_DB_PATH}"
BACKUP_DIR=""
RETENTION_COUNT="${BACKUP_RETENTION_COUNT:-7}"
QUIET=0
DRY_RUN=0

# Log functions
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

# Cross-platform SHA256 helper
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

# Usage documentation
usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Safely creates an online, verified backup of the SQLite database using VACUUM INTO
with PRAGMA integrity verification and atomic replacement without losing old backups.

OPTIONS:
    -d, --db PATH           Path to source SQLite database (default: \${DATABASE_PATH:-./data/movies.db})
    -b, --backup-dir DIR    Destination directory for backups (default: <db_dir>/backups)
    -r, --retention NUM     Number of timestamped backups to keep (default: 7)
    -n, --dry-run           Check configuration and source DB without writing backup
    -q, --quiet             Suppress informational output
    -h, --help              Show this help message
EOF
}

# Parse command line options
while [[ $# -gt 0 ]]; do
    case "$1" in
        -d|--db)
            DB_PATH="$2"
            shift 2
            ;;
        -b|--backup-dir)
            BACKUP_DIR="$2"
            shift 2
            ;;
        -r|--retention)
            RETENTION_COUNT="$2"
            shift 2
            ;;
        -n|--dry-run)
            DRY_RUN=1
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
        *)
            log_error "Unknown argument: $1"
            usage
            exit 1
            ;;
    esac
done

# Validate sqlite3 command
if ! command -v sqlite3 >/dev/null 2>&1; then
    log_error "sqlite3 CLI binary not found."
    log_error "Note: If running on a host without sqlite3, execute inside the container:"
    log_error "  docker compose exec -T film4k-webproxy /app/scripts/backup_sqlite.sh"
    exit 1
fi

# Validate source database
if [ ! -f "$DB_PATH" ]; then
    log_error "Source database does not exist at: $DB_PATH"
    exit 1
fi

if [ ! -r "$DB_PATH" ]; then
    log_error "Source database is not readable: $DB_PATH"
    exit 1
fi

# Quick validation of source database schema
if ! sqlite3 "$DB_PATH" "PRAGMA schema_version;" >/dev/null 2>&1; then
    log_error "Source file is not a valid SQLite database or cannot be read: $DB_PATH"
    exit 1
fi

# Establish backup directory
if [ -z "$BACKUP_DIR" ]; then
    BACKUP_DIR="$(dirname "$DB_PATH")/backups"
fi

DB_NAME="$(basename "$DB_PATH")"
TIMESTAMP="$(date -u +'%Y%m%d_%H%M%SZ')"

# Generate collision-proof unique suffix to avoid overwriting immutable backups
RANDOM_SUFFIX=$(od -vAn -N4 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' || echo "$RANDOM")
if [ -z "$RANDOM_SUFFIX" ]; then
    RANDOM_SUFFIX="r${RANDOM}"
fi

if [ "$DRY_RUN" -eq 1 ]; then
    log_info "DRY RUN MODE: Configuration verified successfully."
    log_info "  Source DB:       $DB_PATH"
    log_info "  Backup Dir:      $BACKUP_DIR"
    log_info "  Retention Count: $RETENTION_COUNT"
    exit 0
fi

# Create backup directory if not exists
mkdir -p "$BACKUP_DIR"
if [ ! -w "$BACKUP_DIR" ]; then
    log_error "Backup directory is not writable: $BACKUP_DIR"
    exit 1
fi

# Target files
LATEST_BACKUP="${BACKUP_DIR}/${DB_NAME}.latest.bak"
PREVIOUS_BACKUP="${BACKUP_DIR}/${DB_NAME}.previous.bak"

# Collision protection for timestamped backup
TIMESTAMPED_BACKUP="${BACKUP_DIR}/${DB_NAME}.${TIMESTAMP}_${RANDOM_SUFFIX}.bak"
while [ -e "$TIMESTAMPED_BACKUP" ]; do
    RANDOM_SUFFIX=$(od -vAn -N4 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' || echo "$RANDOM")
    TIMESTAMPED_BACKUP="${BACKUP_DIR}/${DB_NAME}.${TIMESTAMP}_${RANDOM_SUFFIX}.bak"
done
MANIFEST_FILE="${TIMESTAMPED_BACKUP}.manifest"

# Ensure atomic staging in the SAME directory to guarantee atomic rename across filesystems
TMP_BACKUP="${BACKUP_DIR}/.tmp_${DB_NAME}_${TIMESTAMP}_${RANDOM_SUFFIX}_$$.db"
TMP_PREV=""
TMP_LATEST=""
TMP_MANIFEST=""

# Cleanup trap for abnormal termination
cleanup_tmp() {
    local exit_code=$?
    if [ -f "$TMP_BACKUP" ]; then
        rm -f "$TMP_BACKUP"
    fi
    if [ -n "$TMP_PREV" ] && [ -f "$TMP_PREV" ]; then
        rm -f "$TMP_PREV"
    fi
    if [ -n "$TMP_LATEST" ] && [ -f "$TMP_LATEST" ]; then
        rm -f "$TMP_LATEST"
    fi
    if [ -n "$TMP_MANIFEST" ] && [ -f "$TMP_MANIFEST" ]; then
        rm -f "$TMP_MANIFEST"
    fi
    if [ $exit_code -ne 0 ]; then
        log_error "Backup aborted or failed with exit code $exit_code. Temporary files cleaned up."
    fi
    exit $exit_code
}
trap cleanup_tmp EXIT INT TERM

log_info "Starting safe online backup of $DB_PATH to $BACKUP_DIR"

# Step 1: Perform online snapshot
# Prefer VACUUM INTO as it creates a clean, compacted online copy during live WAL activity.
# Fall back to SQLite Online Backup API (.backup) if VACUUM INTO is not supported.
if sqlite3 "$DB_PATH" "VACUUM INTO '$TMP_BACKUP';" >/dev/null 2>&1; then
    log_info "Online snapshot completed using VACUUM INTO."
else
    log_warn "VACUUM INTO failed or unsupported; falling back to sqlite3 .backup API."
    rm -f "$TMP_BACKUP"
    if ! sqlite3 "$DB_PATH" ".backup '$TMP_BACKUP'"; then
        log_error "Online backup failed."
        exit 1
    fi
fi

# Step 2: Validate file presence and non-empty
if [ ! -s "$TMP_BACKUP" ]; then
    log_error "Backup produced an empty or missing file: $TMP_BACKUP"
    exit 1
fi

# Step 3: Run comprehensive integrity checks on the candidate backup
log_info "Running PRAGMA integrity_check on candidate backup..."
INTEGRITY_RESULT=$(sqlite3 "$TMP_BACKUP" "PRAGMA integrity_check;" 2>&1 || true)
if [ "$INTEGRITY_RESULT" != "ok" ]; then
    log_error "Candidate backup FAILED PRAGMA integrity_check! Output: $INTEGRITY_RESULT"
    exit 2
fi

QUICK_RESULT=$(sqlite3 "$TMP_BACKUP" "PRAGMA quick_check;" 2>&1 || true)
if [ "$QUICK_RESULT" != "ok" ]; then
    log_error "Candidate backup FAILED PRAGMA quick_check! Output: $QUICK_RESULT"
    exit 2
fi

FK_RESULT=$(sqlite3 "$TMP_BACKUP" "PRAGMA foreign_key_check;" 2>&1 || true)
if [ -n "$FK_RESULT" ]; then
    log_warn "Foreign key violations detected in backup: $FK_RESULT"
fi

# Collect metrics
BACKUP_SIZE=$(wc -c < "$TMP_BACKUP" | tr -d ' ')
BACKUP_SHA256=$(compute_sha256 "$TMP_BACKUP")
TABLE_COUNT=$(sqlite3 "$TMP_BACKUP" "SELECT count(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "0")

log_info "Candidate backup verified successfully."
log_info "  Size:   $BACKUP_SIZE bytes"
log_info "  SHA256: $BACKUP_SHA256"
log_info "  Tables: $TABLE_COUNT"

# Step 4: Atomic replacement without losing old backup
# Rule: If LATEST_BACKUP exists, stage copy to temporary file in same directory first,
# then atomically rename to PREVIOUS_BACKUP. This eliminates any window where previous
# could be truncated or corrupted on crash.
if [ -f "$LATEST_BACKUP" ]; then
    log_info "Atomically preserving existing latest backup as previous backup: $PREVIOUS_BACKUP"
    TMP_PREV="${BACKUP_DIR}/.tmp_prev_${TIMESTAMP}_$$.bak"
    cp -p "$LATEST_BACKUP" "$TMP_PREV"
    mv -f "$TMP_PREV" "$PREVIOUS_BACKUP"
    TMP_PREV=""
fi

# Promote candidate backup to timestamped immutable backup (atomic mv on same dir)
mv -f "$TMP_BACKUP" "$TIMESTAMPED_BACKUP"

# Write manifest with SHA256 and metadata
cat > "$MANIFEST_FILE" <<EOF
database_name=${DB_NAME}
source_path=${DB_PATH}
timestamp=${TIMESTAMP}
unique_suffix=${RANDOM_SUFFIX}
size_bytes=${BACKUP_SIZE}
sha256=${BACKUP_SHA256}
table_count=${TABLE_COUNT}
integrity=ok
quick_check=ok
EOF

# Atomically update LATEST_BACKUP using staged atomic replacement in same directory
TMP_LATEST="${BACKUP_DIR}/.tmp_latest_${TIMESTAMP}_$$.bak"
cp -p "$TIMESTAMPED_BACKUP" "$TMP_LATEST"
mv -f "$TMP_LATEST" "$LATEST_BACKUP"
TMP_LATEST=""

# Atomically update latest manifest
TMP_MANIFEST="${BACKUP_DIR}/.tmp_manifest_${TIMESTAMP}_$$.manifest"
cp -p "$MANIFEST_FILE" "$TMP_MANIFEST"
mv -f "$TMP_MANIFEST" "${BACKUP_DIR}/${DB_NAME}.latest.manifest"
TMP_MANIFEST=""

log_info "Backup finalized and atomically rotated."
log_info "  Timestamped: $TIMESTAMPED_BACKUP"
log_info "  Latest:      $LATEST_BACKUP"
if [ -f "$PREVIOUS_BACKUP" ]; then
    log_info "  Previous:    $PREVIOUS_BACKUP"
fi

# Step 5: Rolling retention enforcement (executed strictly AFTER candidate is safely promoted)
if [ "$RETENTION_COUNT" -gt 0 ]; then
    # Find timestamped backups older than the most recent N (excluding the current one)
    BACKUP_FILES=()
    while IFS= read -r file; do
        if [ "$file" != "$TIMESTAMPED_BACKUP" ]; then
            BACKUP_FILES+=("$file")
        fi
    done < <(find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}.20*.bak" ! -name "*.latest.bak" ! -name "*.previous.bak" | sort -r)

    # We want to keep at most RETENTION_COUNT total (including the new one)
    ALLOWED_OLD=$((RETENTION_COUNT - 1))
    TOTAL_OLD=${#BACKUP_FILES[@]}

    if [ "$ALLOWED_OLD" -ge 0 ] && [ "$TOTAL_OLD" -gt "$ALLOWED_OLD" ]; then
        log_info "Enforcing retention: keeping latest + $ALLOWED_OLD historical timestamped backups (total $RETENTION_COUNT)"
        for ((i=ALLOWED_OLD; i<TOTAL_OLD; i++)); do
            EXPIRED_FILE="${BACKUP_FILES[$i]}"
            log_info "Removing expired backup: $EXPIRED_FILE"
            rm -f "$EXPIRED_FILE" "${EXPIRED_FILE}.manifest"
        done
    fi
fi

log_info "Safe online backup procedure completed successfully."
exit 0
