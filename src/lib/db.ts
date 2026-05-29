import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { ISSUE_BODY_CAP, PULL_BODY_CAP } from './body-cap';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'cache.db');

let _db: Database.Database | null = null;
let _readDb: Database.Database | null = null;

// --- One-shot data migration: purge false-positive pr_issue_links (issue #137) ---
// The old link regex lacked a word boundary, so substrings like "bugfix #42"
// or "discloses #42" were persisted as real PR->issue links. The extractor was
// fixed to require `\b`, but `pr_issue_links` is append-only, so the bad rows
// linger. This migration recomputes each cached PR's same-repo links under both
// the old (boundaryless) and new (fixed) patterns and deletes only the
// difference — links the old pattern produced that the fixed one does not.
// Links from GraphQL/sidebar sources are left intact unless they happen to
// coincide with a boundaryless-only regex match (rare; accepted per #137).
const PR_ISSUE_LINKS_SCHEMA_VERSION = 1;
const OLD_LINK_REGEX_NO_BOUNDARY =
  /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*(?:(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+))?#(\d+)/gi;
const NEW_LINK_REGEX_WITH_BOUNDARY =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*(?:(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+))?#(\d+)/gi;

function sameRepoIssueNumbers(pattern: RegExp, repoFullName: string, title: string, body: string | null): Set<number> {
  const text = `${title}\n${body ?? ''}`;
  const out = new Set<number>();
  for (const m of text.matchAll(pattern)) {
    const repo = m[1] || repoFullName;
    if (repo !== repoFullName) continue; // mirror the stored same-repo-only filter
    const n = parseInt(m[2], 10);
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

function purgeBoundarylessPrIssueLinks(db: Database.Database): number {
  const pulls = db
    .prepare('SELECT repo_full_name, number, title, body FROM pulls')
    .all() as Array<{ repo_full_name: string; number: number; title: string; body: string | null }>;
  const del = db.prepare(
    'DELETE FROM pr_issue_links WHERE repo_full_name = ? AND pr_number = ? AND issue_number = ?',
  );
  let removed = 0;
  const tx = db.transaction(() => {
    for (const pr of pulls) {
      const oldIssues = sameRepoIssueNumbers(OLD_LINK_REGEX_NO_BOUNDARY, pr.repo_full_name, pr.title, pr.body);
      if (oldIssues.size === 0) continue;
      const newIssues = sameRepoIssueNumbers(NEW_LINK_REGEX_WITH_BOUNDARY, pr.repo_full_name, pr.title, pr.body);
      for (const issueNum of oldIssues) {
        if (newIssues.has(issueNum)) continue; // still valid under the fixed regex
        removed += del.run(pr.repo_full_name, pr.number, issueNum).changes;
      }
    }
  });
  tx();
  return removed;
}

/**
 * Separate read-only handle so foreground GET routes don't queue behind the
 * poller's big upsert transactions on the writer connection. Both handles
 * share the same on-disk file; with WAL mode, the reader sees a consistent
 * snapshot from before the in-flight writer transaction.
 *
 * Always call after `getDb()` (which performs schema init / migrations) so
 * the read handle never opens against an old shape.
 */
export function getReadDb(): Database.Database {
  if (_readDb) return _readDb;
  // Ensure the writer has run any pending migrations first.
  getDb();
  const db = new Database(DB_PATH, { readonly: true });
  db.pragma('journal_mode = WAL');
  db.pragma('query_only = ON');
  _readDb = db;
  return db;
}

export function getDb(): Database.Database {
  if (_db) return _db;
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // One-time migration off the legacy username/password schema. Must run
  // BEFORE the main CREATE TABLE IF NOT EXISTS below — otherwise the no-op
  // create leaves the old shape in place and subsequent CREATE INDEX statements
  // on github_id fail with "no such column".
  {
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
      .get() as { name: string } | undefined;
    if (exists) {
      const userCols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
      const hasGithubId = userCols.some((c) => c.name === 'github_id');
      const hasPasswordHash = userCols.some((c) => c.name === 'password_hash');
      if (hasPasswordHash || !hasGithubId) {
        db.exec('DROP TABLE users;');
        console.log('[auth] dropped legacy users table — accounts wiped per GitHub-OAuth migration.');
      }
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_full_name     TEXT NOT NULL,
      number             INTEGER NOT NULL,
      title              TEXT NOT NULL,
      body               TEXT,
      body_truncated     INTEGER NOT NULL DEFAULT 0,
      state              TEXT NOT NULL,
      state_reason       TEXT,
      author_login       TEXT,
      author_association TEXT,
      labels             TEXT,
      comments           INTEGER DEFAULT 0,
      created_at         TEXT,
      updated_at         TEXT,
      closed_at          TEXT,
      html_url           TEXT,
      raw_json           TEXT,
      fetched_at         TEXT NOT NULL,
      first_seen_at      TEXT NOT NULL,
      UNIQUE(repo_full_name, number)
    );

    CREATE INDEX IF NOT EXISTS idx_issues_repo ON issues(repo_full_name);
    CREATE INDEX IF NOT EXISTS idx_issues_state ON issues(state);
    CREATE INDEX IF NOT EXISTS idx_issues_first_seen ON issues(first_seen_at);
    -- Hot-path indexes: per-author groupings + sort-by-updated-at LIMIT N pages.
    CREATE INDEX IF NOT EXISTS idx_issues_repo_author ON issues(repo_full_name, author_login);
    CREATE INDEX IF NOT EXISTS idx_issues_repo_updated ON issues(repo_full_name, updated_at);
    CREATE INDEX IF NOT EXISTS idx_issues_repo_created ON issues(repo_full_name, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_issues_repo_author_updated ON issues(repo_full_name, author_login, updated_at);
    CREATE INDEX IF NOT EXISTS idx_issues_seen_created_repo ON issues(first_seen_at, created_at, repo_full_name);

    CREATE TABLE IF NOT EXISTS pulls (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_full_name     TEXT NOT NULL,
      number             INTEGER NOT NULL,
      title              TEXT NOT NULL,
      body               TEXT,
      body_truncated     INTEGER NOT NULL DEFAULT 0,
      state              TEXT NOT NULL,
      draft              INTEGER DEFAULT 0,
      merged             INTEGER DEFAULT 0,
      author_login       TEXT,
      author_association TEXT,
      created_at         TEXT,
      updated_at         TEXT,
      closed_at          TEXT,
      merged_at          TEXT,
      html_url           TEXT,
      raw_json           TEXT,
      fetched_at         TEXT NOT NULL,
      first_seen_at      TEXT NOT NULL,
      UNIQUE(repo_full_name, number)
    );

    CREATE INDEX IF NOT EXISTS idx_pulls_repo ON pulls(repo_full_name);
    CREATE INDEX IF NOT EXISTS idx_pulls_author ON pulls(author_login);
    CREATE INDEX IF NOT EXISTS idx_pulls_state ON pulls(state);
    CREATE INDEX IF NOT EXISTS idx_pulls_repo_updated ON pulls(repo_full_name, updated_at);
    CREATE INDEX IF NOT EXISTS idx_pulls_repo_created ON pulls(repo_full_name, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_pulls_repo_author ON pulls(repo_full_name, author_login);
    CREATE INDEX IF NOT EXISTS idx_pulls_seen_created_repo ON pulls(first_seen_at, created_at, repo_full_name);

    -- Per-user "valid / invalid" marker on an issue. Independent of GitHub's
    -- own state — this is the dashboard user's own judgement after a manual
    -- review. Cleared by deleting the row.
    CREATE TABLE IF NOT EXISTS issue_validations (
      user_id        INTEGER NOT NULL,
      repo_full_name TEXT NOT NULL,
      issue_number   INTEGER NOT NULL,
      status         TEXT NOT NULL CHECK(status IN ('valid', 'invalid')),
      set_at         TEXT NOT NULL,
      PRIMARY KEY (user_id, repo_full_name, issue_number)
    );
    CREATE INDEX IF NOT EXISTS idx_issue_validations_repo ON issue_validations(repo_full_name, issue_number);

    CREATE TABLE IF NOT EXISTS repo_meta (
      full_name                  TEXT PRIMARY KEY,
      last_issues_fetch          TEXT,
      last_pulls_fetch           TEXT,
      last_fetch_error           TEXT,
      issues_bootstrap_done_at   TEXT,
      pulls_bootstrap_done_at    TEXT,
      issues_bootstrap_version   INTEGER NOT NULL DEFAULT 0,
      pulls_bootstrap_version    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS repo_badges (
      full_name            TEXT PRIMARY KEY,
      issues_count         INTEGER NOT NULL DEFAULT 0,
      pulls_count          INTEGER NOT NULL DEFAULT 0,
      owner_comments_count INTEGER NOT NULL DEFAULT 0,
      issues_source        TEXT,
      pulls_source         TEXT,
      comments_source      TEXT,
      updated_at           TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_repos (
      full_name  TEXT PRIMARY KEY,
      weight     REAL NOT NULL DEFAULT 0.01,
      notes      TEXT,
      added_at   TEXT NOT NULL
    );

    -- Authoritative per-repo weight, refreshed by each live sync of
    -- master_repositories.json. The table mirrors the latest successful live
    -- Gittensor repo list, so repos dropped upstream are removed instead of
    -- lingering with stale cached issues/PRs.
    CREATE TABLE IF NOT EXISTS repo_weights (
      full_name   TEXT PRIMARY KEY,
      weight      REAL NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL,
      config_json TEXT
    );

    CREATE TABLE IF NOT EXISTS issue_comments (
      comment_id         INTEGER PRIMARY KEY,
      repo_full_name     TEXT NOT NULL,
      issue_number       INTEGER NOT NULL,
      author_login       TEXT,
      author_association TEXT,
      body               TEXT,
      html_url           TEXT,
      created_at         TEXT,
      updated_at         TEXT,
      fetched_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_repo ON issue_comments(repo_full_name);
    CREATE INDEX IF NOT EXISTS idx_comments_repo_assoc ON issue_comments(repo_full_name, author_association);
    CREATE INDEX IF NOT EXISTS idx_comments_repo_created ON issue_comments(repo_full_name, created_at);

    -- Denormalized "PR closes/fixes/resolves issue #N" links extracted from
    -- PR bodies + titles. Lets the dashboard compute the "closed without a
    -- linked PR → effectively Not planned" override server-side without
    -- re-scanning every PR body on each request.
    CREATE TABLE IF NOT EXISTS pr_issue_links (
      repo_full_name TEXT NOT NULL,
      pr_number      INTEGER NOT NULL,
      issue_number   INTEGER NOT NULL,
      PRIMARY KEY (repo_full_name, pr_number, issue_number)
    );
    CREATE INDEX IF NOT EXISTS idx_pr_issue_links_issue ON pr_issue_links(repo_full_name, issue_number);
    CREATE INDEX IF NOT EXISTS idx_pr_issue_links_repo_issue_pr ON pr_issue_links(repo_full_name, issue_number, pr_number);

    CREATE TABLE IF NOT EXISTS users (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      github_id         TEXT NOT NULL UNIQUE,
      github_login      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      avatar_url        TEXT,
      status            TEXT NOT NULL DEFAULT 'approved',
      is_admin          INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL,
      last_login_at     TEXT,
      approved_at       TEXT,
      approved_by_id    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
  `);

  // Migrations for existing DBs: add new columns if missing
  const repoMetaCols = db
    .prepare("PRAGMA table_info(repo_meta)")
    .all() as Array<{ name: string }>;
  const haveCol = (n: string) => repoMetaCols.some((c) => c.name === n);
  if (!haveCol('issues_bootstrap_done_at')) {
    db.exec('ALTER TABLE repo_meta ADD COLUMN issues_bootstrap_done_at TEXT');
  }
  if (!haveCol('pulls_bootstrap_done_at')) {
    db.exec('ALTER TABLE repo_meta ADD COLUMN pulls_bootstrap_done_at TEXT');
  }
  if (!haveCol('issues_bootstrap_version')) {
    db.exec('ALTER TABLE repo_meta ADD COLUMN issues_bootstrap_version INTEGER NOT NULL DEFAULT 0');
  }
  if (!haveCol('pulls_bootstrap_version')) {
    db.exec('ALTER TABLE repo_meta ADD COLUMN pulls_bootstrap_version INTEGER NOT NULL DEFAULT 0');
  }
  if (!haveCol('closing_issues_backfilled_at')) {
    db.exec('ALTER TABLE repo_meta ADD COLUMN closing_issues_backfilled_at TEXT');
  }
  if (!haveCol('issue_body_links_backfilled_at')) {
    db.exec('ALTER TABLE repo_meta ADD COLUMN issue_body_links_backfilled_at TEXT');
  }
  // Marker for backfillPrIssueLinksIfNeeded — set on first successful
  // backfill so a repo with legitimately zero linked issues doesn't
  // get re-scanned on every request (existingCount === 0 alone isn't
  // enough to distinguish "never ran" from "ran, found nothing").
  if (!haveCol('pr_issue_links_backfilled_at')) {
    db.exec('ALTER TABLE repo_meta ADD COLUMN pr_issue_links_backfilled_at TEXT');
  }

  const repoWeightsCols = db.prepare('PRAGMA table_info(repo_weights)').all() as Array<{ name: string }>;
  if (!repoWeightsCols.some((c) => c.name === 'config_json')) {
    db.exec('ALTER TABLE repo_weights ADD COLUMN config_json TEXT');
  }

  // `pulls.author_association` was added later to mirror the issues table —
  // existing PR rows will be NULL until the next poll re-upserts them, which
  // is fine since refresh.ts:upsertPull now writes the column.
  const pullsCols = db.prepare("PRAGMA table_info(pulls)").all() as Array<{ name: string }>;
  if (!pullsCols.some((c) => c.name === 'author_association')) {
    db.exec('ALTER TABLE pulls ADD COLUMN author_association TEXT');
  }

  // `body_truncated` (issue #165) records whether a stored body was capped by
  // the poller, replacing the old "stored length == cap" inference in the
  // detail routes. When the column is first added we backfill it: a poller-
  // capped body lands at exactly the cap length, so flag those rows truncated.
  // Erring toward `1` is the safe direction — a false truncated flag costs one
  // detail re-fetch that then re-stores the full body and self-heals the flag,
  // whereas a false complete flag would serve a clipped body as if whole.
  // The ADD COLUMN and its backfill must commit together: if a crash landed
  // between them, the next boot would see the column present, skip this block,
  // and leave capped rows defaulted to 0 (complete) — the unsafe direction.
  // Wrapping in a transaction rolls the ALTER back too, so the migration re-runs.
  const issuesCols = db.prepare("PRAGMA table_info(issues)").all() as Array<{ name: string }>;
  if (!issuesCols.some((c) => c.name === 'body_truncated')) {
    db.transaction(() => {
      db.exec('ALTER TABLE issues ADD COLUMN body_truncated INTEGER NOT NULL DEFAULT 0');
      db.prepare('UPDATE issues SET body_truncated = 1 WHERE body IS NOT NULL AND length(body) = ?')
        .run(ISSUE_BODY_CAP);
    })();
  }
  if (!pullsCols.some((c) => c.name === 'body_truncated')) {
    db.transaction(() => {
      db.exec('ALTER TABLE pulls ADD COLUMN body_truncated INTEGER NOT NULL DEFAULT 0');
      db.prepare('UPDATE pulls SET body_truncated = 1 WHERE body IS NOT NULL AND length(body) = ?')
        .run(PULL_BODY_CAP);
    })();
  }

  // One-shot purge of false-positive pr_issue_links (issue #137). Guarded by
  // PRAGMA user_version so it runs exactly once per database file.
  const schemaVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (schemaVersion < PR_ISSUE_LINKS_SCHEMA_VERSION) {
    const removed = purgeBoundarylessPrIssueLinks(db);
    db.exec(`PRAGMA user_version = ${PR_ISSUE_LINKS_SCHEMA_VERSION}`);
    if (removed > 0) {
      console.log(`[migration] purged ${removed} false-positive pr_issue_links (issue #137)`);
    }
  }

  _db = db;
  return db;
}

export interface IssueRow {
  id: number;
  repo_full_name: string;
  number: number;
  title: string;
  body: string | null;
  body_truncated: number;
  state: string;
  state_reason: string | null;
  author_login: string | null;
  author_association: string | null;
  labels: string | null;
  comments: number;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  html_url: string | null;
  fetched_at: string;
  first_seen_at: string;
}

export interface PullRow {
  id: number;
  repo_full_name: string;
  number: number;
  title: string;
  body: string | null;
  body_truncated: number;
  state: string;
  draft: number;
  merged: number;
  author_login: string | null;
  author_association: string | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  merged_at: string | null;
  html_url: string | null;
  fetched_at: string;
  first_seen_at: string;
}

export interface RepoMetaRow {
  full_name: string;
  last_issues_fetch: string | null;
  last_pulls_fetch: string | null;
  last_fetch_error: string | null;
}
