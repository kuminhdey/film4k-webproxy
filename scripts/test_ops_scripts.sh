#!/usr/bin/env bash
# ==============================================================================
# scripts/test_ops_scripts.sh
# Automated Test Suite for Release/Ops Scripts (Backup & Restore Rehearsal)
#
# Validates:
# - Online safe SQLite backup via VACUUM INTO
# - PRAGMA integrity verification
# - Atomic rotation preserving previous backups without data loss
# - Failure abort with zero corruption of existing backups
# - Isolated restore rehearsal with strict live DB isolation assertion
# - Detection and rejection of corrupted backup images
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="${SCRIPT_DIR}/backup_sqlite.sh"
RESTORE_SCRIPT="${SCRIPT_DIR}/restore_rehearsal.sh"

PASSED_COUNT=0
FAILED_COUNT=0

log_test() {
    printf "==> [TEST] %s\n" "$*"
}

pass() {
    printf "    [PASS] %s\n" "$*"
    PASSED_COUNT=$((PASSED_COUNT + 1))
}

fail() {
    printf "    [FAIL] %s\n" "$*" >&2
    FAILED_COUNT=$((FAILED_COUNT + 1))
}

# Ensure required scripts exist and are executable
if [ ! -x "$BACKUP_SCRIPT" ] || [ ! -x "$RESTORE_SCRIPT" ]; then
    printf "[ERROR] Required scripts missing or not executable.\n" >&2
    exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
    printf "[ERROR] sqlite3 is required to run ops script tests.\n" >&2
    exit 1
fi

TEST_WORKSPACE=$(mktemp -d -t webproxy_test_ops_XXXXXX)
cleanup() {
    rm -rf "$TEST_WORKSPACE"
}
trap cleanup EXIT INT TERM

TEST_DATA_DIR="${TEST_WORKSPACE}/data"
BACKUP_DIR="${TEST_WORKSPACE}/backups"
TEST_DB="${TEST_DATA_DIR}/movies.db"

mkdir -p "$TEST_DATA_DIR" "$BACKUP_DIR"

# Helper to create initial database
init_test_db() {
    sqlite3 "$TEST_DB" <<SQL
PRAGMA journal_mode = WAL;
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);
INSERT INTO schema_migrations VALUES (1, datetime('now'));

CREATE TABLE movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
INSERT INTO movies (title, slug) VALUES 
    ('Inception', 'inception-2010'),
    ('Interstellar', 'interstellar-2014'),
    ('The Matrix', 'the-matrix-1999');
SQL
}

init_test_db

# ------------------------------------------------------------------------------
# Test 1: Successful initial safe online backup
# ------------------------------------------------------------------------------
log_test "Test 1: Initial online safe SQLite backup with integrity check"
if "$BACKUP_SCRIPT" --db "$TEST_DB" --backup-dir "$BACKUP_DIR" --quiet; then
    LATEST_BAK="${BACKUP_DIR}/movies.db.latest.bak"
    LATEST_MANIFEST="${BACKUP_DIR}/movies.db.latest.manifest"
    if [ -f "$LATEST_BAK" ] && [ -f "$LATEST_MANIFEST" ]; then
        ROWS=$(sqlite3 "$LATEST_BAK" "SELECT count(*) FROM movies;")
        if [ "$ROWS" -eq 3 ]; then
            pass "Initial backup created, verified, and contains 3 movies."
        else
            fail "Expected 3 movies in backup, got: $ROWS"
        fi
    else
        fail "Latest backup or manifest missing."
    fi
else
    fail "backup_sqlite.sh exited with non-zero status on valid DB."
fi

# ------------------------------------------------------------------------------
# Test 2: Atomic rotation & preservation of previous backup without loss
# ------------------------------------------------------------------------------
log_test "Test 2: Atomic replacement preserves old backup as previous.bak"
# Add 2 more movies to live DB
sqlite3 "$TEST_DB" "INSERT INTO movies (title, slug) VALUES ('Oppenheimer', 'oppenheimer-2023'), ('Dune', 'dune-2021');"
LIVE_COUNT=$(sqlite3 "$TEST_DB" "SELECT count(*) FROM movies;") # Should be 5

# Allow clock tick so timestamp differs
sleep 1

if "$BACKUP_SCRIPT" --db "$TEST_DB" --backup-dir "$BACKUP_DIR" --quiet; then
    PREV_BAK="${BACKUP_DIR}/movies.db.previous.bak"
    LATEST_BAK="${BACKUP_DIR}/movies.db.latest.bak"

    if [ -f "$PREV_BAK" ] && [ -f "$LATEST_BAK" ]; then
        PREV_COUNT=$(sqlite3 "$PREV_BAK" "SELECT count(*) FROM movies;")
        LATEST_COUNT=$(sqlite3 "$LATEST_BAK" "SELECT count(*) FROM movies;")

        if [ "$PREV_COUNT" -eq 3 ] && [ "$LATEST_COUNT" -eq 5 ]; then
            pass "Old backup preserved (3 rows) and latest atomically updated (5 rows)."
        else
            fail "Rotation data mismatch: previous=$PREV_COUNT (expected 3), latest=$LATEST_COUNT (expected 5)"
        fi
    else
        fail "previous.bak or latest.bak missing after rotation."
    fi
else
    fail "backup_sqlite.sh failed on second rotation pass."
fi

# ------------------------------------------------------------------------------
# Test 3: Abort on non-existent or invalid source DB
# ------------------------------------------------------------------------------
log_test "Test 3: Graceful failure and exit on non-existent DB"
if "$BACKUP_SCRIPT" --db "${TEST_DATA_DIR}/nonexistent.db" --backup-dir "$BACKUP_DIR" --quiet >/dev/null 2>&1; then
    fail "backup_sqlite.sh should have failed on non-existent DB."
else
    pass "backup_sqlite.sh correctly failed on non-existent DB."
fi

# ------------------------------------------------------------------------------
# Test 4: Restore rehearsal on valid backup with live DB isolation assertion
# ------------------------------------------------------------------------------
log_test "Test 4: Isolated restore rehearsal against latest backup"
if "$RESTORE_SCRIPT" --file "${BACKUP_DIR}/movies.db.latest.bak" --live-db "$TEST_DB" --quiet; then
    # Verify live DB was untouched
    POST_LIVE_COUNT=$(sqlite3 "$TEST_DB" "SELECT count(*) FROM movies;")
    if [ "$POST_LIVE_COUNT" -eq 5 ]; then
        pass "Restore rehearsal succeeded and live DB remained untouched (5 rows)."
    else
        fail "Live DB row count changed during rehearsal! Got: $POST_LIVE_COUNT"
    fi
else
    fail "restore_rehearsal.sh exited with non-zero status on valid backup."
fi

# ------------------------------------------------------------------------------
# Test 5: Rehearsal detects and rejects corrupted backup
# ------------------------------------------------------------------------------
log_test "Test 5: Restore rehearsal detects corrupted backup file"
CORRUPT_BAK="${BACKUP_DIR}/corrupt_test.bak"
printf "THIS_IS_CORRUPTED_NON_SQLITE_GARBAGE_DATA\x00\xff\xfe" > "$CORRUPT_BAK"

if "$RESTORE_SCRIPT" --file "$CORRUPT_BAK" --live-db "$TEST_DB" --quiet >/dev/null 2>&1; then
    fail "restore_rehearsal.sh should have rejected corrupted backup file."
else
    pass "restore_rehearsal.sh correctly detected corruption and returned non-zero."
fi

# ------------------------------------------------------------------------------
# Final Test Summary
# ------------------------------------------------------------------------------
printf "\n========================================\n"
printf "       OPS SCRIPTS TEST SUMMARY\n"
printf "========================================\n"
printf "Passed: %d\n" "$PASSED_COUNT"
printf "Failed: %d\n" "$FAILED_COUNT"
printf "========================================\n"

if [ "$FAILED_COUNT" -gt 0 ]; then
    exit 1
fi

exit 0
