#!/usr/bin/env bash
# Generate a sanitized SQLite snapshot of the dashboard cache for distribution
# to contributors. User-side tables (users, issue_validations, user_repos) are
# always wiped. The --light flag also trims issues/PRs to recent entries from
# the top-weighted repos so the seed fits under GitHub's 2 GB asset limit.
#
# Usage:
#   ./scripts/generate-seed.sh                # full snapshot (large)
#   ./scripts/generate-seed.sh --light        # ~30-day, top-20-repos snapshot
#
# Output: data/seed.db.gz

set -euo pipefail

SRC_DB="${SRC_DB:-data/cache.db}"
OUT_DIR="${OUT_DIR:-data}"
TMP_DB="$(mktemp /tmp/gittensor-seed-XXXXXX.db)"
LIGHT=0

if [[ "${1:-}" == "--light" ]]; then
  LIGHT=1
fi

if [[ ! -f "$SRC_DB" ]]; then
  echo "Source DB not found: $SRC_DB" >&2
  exit 1
fi

echo "Hot-copying $SRC_DB → $TMP_DB"
sqlite3 "$SRC_DB" ".backup '$TMP_DB'"

echo "Wiping user-side tables"
sqlite3 "$TMP_DB" <<'SQL'
DELETE FROM users;
DELETE FROM issue_validations;
DELETE FROM user_repos;
SQL

if [[ "$LIGHT" == "1" ]]; then
  echo "Trimming to last 30 days for top-20 repos by weight"
  sqlite3 "$TMP_DB" <<'SQL'
-- Keep top 20 repos by weight; drop everything else from the row tables.
CREATE TEMP TABLE keep_repos AS
  SELECT full_name FROM repo_weights
  ORDER BY weight DESC
  LIMIT 20;

DELETE FROM issues
 WHERE repo_full_name NOT IN (SELECT full_name FROM keep_repos)
    OR (created_at IS NOT NULL AND created_at < date('now', '-30 days'));

DELETE FROM pulls
 WHERE repo_full_name NOT IN (SELECT full_name FROM keep_repos)
    OR (created_at IS NOT NULL AND created_at < date('now', '-30 days'));

DELETE FROM issue_comments
 WHERE repo_full_name NOT IN (SELECT full_name FROM keep_repos);

DELETE FROM pr_issue_links
 WHERE repo_full_name NOT IN (SELECT full_name FROM keep_repos);

DELETE FROM repo_meta
 WHERE full_name NOT IN (SELECT full_name FROM keep_repos);

DELETE FROM repo_badges
 WHERE full_name NOT IN (SELECT full_name FROM keep_repos);
SQL
fi

echo "Vacuuming"
sqlite3 "$TMP_DB" "VACUUM;"

OUT="$OUT_DIR/seed.db.gz"
echo "Compressing → $OUT"
mkdir -p "$OUT_DIR"
gzip -9 -c "$TMP_DB" > "$OUT"

rm -f "$TMP_DB"

SIZE_HUMAN=$(du -h "$OUT" | awk '{print $1}')
echo "Done. $OUT ($SIZE_HUMAN)"
echo
echo "Next step: upload $OUT as an asset on a GitHub Release."
echo "  Recommended tag: seed-$(date +%F)"
echo "  Then contributors run: ./scripts/seed-db.sh"
