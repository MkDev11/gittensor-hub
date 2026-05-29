import { getDb, getReadDb } from './db';
import {
  fetchIssuesFromGithub,
  fetchIssueCommentsFromGithub,
  fetchIssueLinkedPrs,
  fetchPrsClosingIssuesBatch,
  fetchPullsFromGithub,
  GhComment,
  GhIssue,
  GhPull,
  withRotation,
} from './github';
import { extractLinkedIssues } from './pr-linking';
import { ISSUE_BODY_CAP, PULL_BODY_CAP, capBody } from './body-cap';

/**
 * Add this PR's `pr_issue_links` rows from the body+title regex. Only
 * same-repo links are stored — cross-repo references aren't something the
 * per-repo views need.
 *
 * NOTE: This used to DELETE every row for the PR before re-inserting, but
 * that wiped out the strictly-larger set of links discovered by the
 * GraphQL closingIssuesReferences backfill (parenthetical `(#N)` refs,
 * sidebar-linked issues, etc.) on every poll. We now `INSERT OR IGNORE`
 * additively so the GraphQL-derived links survive subsequent polls. Stale
 * removals — i.e., a PR whose body once said "fixes #X" but no longer does
 * — are accepted as a minor cost; the link table is treated as a union of
 * everything that has ever pointed at the issue.
 */
function replacePrIssueLinks(
  repoFullName: string,
  prNumber: number,
  title: string,
  body: string | null,
): void {
  const db = getDb();
  const links = extractLinkedIssues({ title, body, repo_full_name: repoFullName });
  if (links.length === 0) return;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO pr_issue_links (repo_full_name, pr_number, issue_number)
     VALUES (?, ?, ?)`
  );
  for (const l of links) {
    if (l.repo && l.repo !== repoFullName) continue;
    insert.run(repoFullName, prNumber, l.number);
  }
}

// (Removed) Earlier revision had an `addIssueBodyPrLinks` helper that
// regex-scanned issue bodies for every `#N` mention and inserted them as
// candidate `pr_issue_links`. GitHub's own rule — only Closes/Fixes/Resolves
// keywords (or sidebar-linked PRs) constitute a real link — makes that
// approach far too permissive: a plain `#123` mention is a cross-reference,
// not a closing link. The authoritative GraphQL fields
// `PullRequest.closingIssuesReferences` (PR→issue) and
// `Issue.closedByPullRequestsReferences` (issue→PR, includeClosedPrs: true)
// already cover both directions, so we rely on those exclusively.

/**
 * One-shot backfill of `pr_issue_links` from GitHub's GraphQL API for every
 * cached PR in a repo. Catches links that the body-regex extractor misses —
 * parenthetical `(#N)` references, Development-sidebar manual links, and
 * keyword references that span the truncated body. Stamps
 * `closing_issues_backfilled_at` so we don't re-do completed repos.
 *
 * Returns counts so the caller can log progress.
 */
const CLOSING_BACKFILL_BATCH = 50;
const CLOSING_BACKFILL_PAUSE_MS = 200;

export async function backfillClosingIssuesForRepo(
  repoFullName: string,
): Promise<{ scanned: number; new_links: number; failed_batches: number }> {
  const [owner, repo] = repoFullName.split('/');
  if (!owner || !repo) return { scanned: 0, new_links: 0, failed_batches: 0 };
  const db = getDb();

  const prs = db
    .prepare(`SELECT number FROM pulls WHERE repo_full_name = ? ORDER BY number`)
    .all(repoFullName) as Array<{ number: number }>;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO pr_issue_links (repo_full_name, pr_number, issue_number)
     VALUES (?, ?, ?)`,
  );

  let scanned = 0;
  let newLinks = 0;
  let failedBatches = 0;
  let failedPrs = 0;

  /**
   * Run one batch. On failure, bisect down to size 1 — that way GitHub's
   * cost-limit / partial-data errors only cost us the truly offending PR's
   * links instead of the entire 50-PR neighborhood. Previously a single bad
   * batch silently dropped 50 PRs' worth of `closingIssuesReferences`,
   * which is how `entrius/gittensor#1110` was showing 3 linked PRs in the
   * dashboard while GitHub itself reported 7.
   */
  const runBatch = async (batch: number[], depth = 0): Promise<void> => {
    try {
      const refs = await fetchPrsClosingIssuesBatch(owner, repo, batch);
      const tx = db.transaction(() => {
        for (const [prNum, issueNums] of refs.entries()) {
          for (const issueNum of issueNums) {
            const r = insert.run(repoFullName, prNum, issueNum);
            if (r.changes > 0) newLinks += 1;
          }
        }
      });
      tx();
      scanned += batch.length;
    } catch (err) {
      if (batch.length <= 1) {
        failedPrs += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[closing-backfill] ${repoFullName} PR #${batch[0]} failed after bisection: ${msg.slice(0, 200)}`,
        );
        return;
      }
      // Avoid runaway recursion / hammering on a stuck batch: cap depth at 6
      // (50 → 25 → 12 → 6 → 3 → 1 → 1).
      if (depth === 0) failedBatches += 1;
      const mid = Math.ceil(batch.length / 2);
      const left = batch.slice(0, mid);
      const right = batch.slice(mid);
      await runBatch(left, depth + 1);
      // Small pause between halves so we don't burst on the failing
      // size-class while GitHub is already complaining.
      await new Promise((r) => setTimeout(r, 100));
      await runBatch(right, depth + 1);
    }
  };

  for (let i = 0; i < prs.length; i += CLOSING_BACKFILL_BATCH) {
    const batch = prs.slice(i, i + CLOSING_BACKFILL_BATCH).map((p) => p.number);
    await runBatch(batch);
    if (i + CLOSING_BACKFILL_BATCH < prs.length) {
      await new Promise((r) => setTimeout(r, CLOSING_BACKFILL_PAUSE_MS));
    }
  }
  if (failedPrs > 0) {
    console.warn(`[closing-backfill] ${repoFullName} skipped ${failedPrs} PR(s) after bisection`);
  }

  db.prepare(`UPDATE repo_meta SET closing_issues_backfilled_at = ? WHERE full_name = ?`).run(
    nowIso(),
    repoFullName,
  );

  return { scanned, new_links: newLinks, failed_batches: failedBatches };
}

/**
 * Background sweep: scan every repo whose `closing_issues_backfilled_at` is
 * NULL and run `backfillClosingIssuesForRepo` on each. One repo at a time so
 * we don't hammer GitHub. Safe to call concurrently — guarded by an in-memory
 * flag and the per-repo timestamp.
 */
let closingBackfillRunning = false;

export async function runClosingBackfillSweep(): Promise<void> {
  if (closingBackfillRunning) return;
  closingBackfillRunning = true;
  try {
    const db = getDb();
    const repos = db
      .prepare(
        `SELECT full_name FROM repo_meta
         WHERE closing_issues_backfilled_at IS NULL
         ORDER BY full_name`,
      )
      .all() as Array<{ full_name: string }>;
    if (repos.length === 0) {
      console.log('[closing-backfill] all repos already backfilled — nothing to do');
      return;
    }
    console.log(`[closing-backfill] starting sweep over ${repos.length} repo(s)`);
    let totalScanned = 0;
    let totalNew = 0;
    for (const r of repos) {
      const t0 = Date.now();
      const { scanned, new_links, failed_batches } = await backfillClosingIssuesForRepo(r.full_name);
      totalScanned += scanned;
      totalNew += new_links;
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `[closing-backfill] ${r.full_name}: scanned=${scanned} new_links=${new_links} failed_batches=${failed_batches} (${dt}s)`,
      );
    }
    console.log(
      `[closing-backfill] sweep complete: ${totalScanned} PRs scanned, ${totalNew} new links discovered across ${repos.length} repo(s)`,
    );
  } finally {
    closingBackfillRunning = false;
  }
}

// Per-issue linked-PR refresh throttle — GraphQL is expensive, so we cache
// the success of a fetch in memory and only re-query after this window.
const LINKED_PRS_STALE_MS = 6 * 60 * 60_000;
const lastLinkedPrsFetch = new Map<string, number>();
const inFlightLinkedPrs = new Map<string, Promise<void>>();

async function hydrateMissingLinkedPulls(owner: string, repo: string, prNums: number[]): Promise<void> {
  if (prNums.length === 0) return;
  const fullName = `${owner}/${repo}`;
  const placeholders = prNums.map(() => '?').join(',');
  const existing = getDb()
    .prepare(`SELECT number FROM pulls WHERE repo_full_name = ? AND number IN (${placeholders})`)
    .all(fullName, ...prNums) as Array<{ number: number }>;
  const existingNums = new Set(existing.map((row) => row.number));
  const missing = prNums.filter((prNum) => !existingNums.has(prNum));
  for (const prNum of missing) {
    try {
      const data = await withRotation(async (octokit) => {
        const resp = await octokit.pulls.get({ owner, repo, pull_number: prNum });
        return resp.data;
      });
      upsertPull(fullName, {
        number: data.number,
        title: data.title,
        body: data.body ?? null,
        state: data.state,
        draft: Boolean(data.draft),
        user: data.user ? { login: data.user.login } : null,
        author_association: data.author_association ?? 'NONE',
        created_at: data.created_at,
        updated_at: data.updated_at,
        closed_at: data.closed_at,
        merged_at: data.merged_at,
        html_url: data.html_url,
      });
    } catch {
      // The link row is still useful; a later repo sync or detail fetch can
      // fill the PR metadata.
    }
  }
}

/**
 * Fill in any UI-linked / parenthetical-referenced PRs for a single issue
 * that the body-regex extractor would otherwise miss. Idempotent, rate-
 * limited per `(repo, issueNumber)`, and safe to await on responses that
 * depend on fresh link rows.
 */
export async function refreshIssueLinkedPrsIfStale(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<void> {
  const key = `${owner}/${repo}#${issueNumber}`;
  const last = lastLinkedPrsFetch.get(key);
  if (last && Date.now() - last < LINKED_PRS_STALE_MS) return;
  const inflight = inFlightLinkedPrs.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const prNums = await fetchIssueLinkedPrs(owner, repo, issueNumber);
      const fullName = `${owner}/${repo}`;
      const insert = getDb().prepare(
        `INSERT OR IGNORE INTO pr_issue_links (repo_full_name, pr_number, issue_number)
         VALUES (?, ?, ?)`
      );
      const tx = getDb().transaction(() => {
        for (const prNum of prNums) insert.run(fullName, prNum, issueNumber);
      });
      tx();
      await hydrateMissingLinkedPulls(owner, repo, prNums);
      lastLinkedPrsFetch.set(key, Date.now());
    } catch {
      // Don't poison the throttle on transient errors — a future call will
      // retry the GraphQL fetch.
    } finally {
      inFlightLinkedPrs.delete(key);
    }
  })();
  inFlightLinkedPrs.set(key, p);
  return p;
}

/** Per-repo in-flight gate so concurrent cold requests don't each schedule
 *  their own backfill (which would queue serially on the better-sqlite3
 *  writer connection and amplify the event-loop stall). */
const inFlightLinksBackfill = new Set<string>();

/** Defer-and-fire-and-forget backfill of `pr_issue_links`. Called from
 *  request handlers (8 routes) but never blocks the request path: the
 *  heavy synchronous work (load all pulls, regex-extract every body,
 *  write links in a tx) is moved off the current event-loop tick via
 *  setImmediate so the route returns immediately. Was previously
 *  blocking inline — for repos with hundreds of PRs the synchronous
 *  load-all-pulls + regex + writer transaction could stall the event
 *  loop long enough for Cloudflare to 524 (>100s) at the edge before
 *  the route ever responded.
 *
 *  Returns the current `pr_issue_links` count for this repo (0 means
 *  "backfill scheduled, retry shortly"). Callers don't consume the
 *  return value today, but it preserves the original signature so the
 *  8 existing call sites need no changes.
 *
 *  KNOWN TRADEOFFS (acceptable vs the previous 524, but worth tracking):
 *
 *  1. First-request emptiness: the FIRST cold-cache request per repo
 *     returns empty linked-PR / linked-issue enrichment. Subsequent
 *     requests (after the deferred backfill commits) see the full
 *     data. For `/api/repos/[owner]/[name]/issues` this is fine — the
 *     skeleton renders empty briefly then auto-refetches. For
 *     `/api/repos/[owner]/[name]/issues-meta` this is louder because
 *     `state_counts.completed` depends on the JOIN being populated;
 *     until backfill commits, Completed issues are bucketed as
 *     Not-planned. Self-heals in ~1 polling interval (15s). A future
 *     fix could add `awaitBackfill(repo, timeoutMs)` for callers that
 *     need correctness over latency.
 *
 *  2. Second-request blocking: better-sqlite3 transactions are
 *     synchronous; once the deferred backfill starts running, OTHER
 *     in-flight requests still block on the event loop until the tx
 *     commits. For very large repos the backfill itself could still
 *     exceed Cloudflare's 100s. Future fix would chunk the
 *     transaction to commit in smaller batches with setImmediate
 *     yields between batches. */
export function backfillPrIssueLinksIfNeeded(repoFullName: string): number {
  const normalizedRepo = repoFullName.trim().toLowerCase();
  if (!normalizedRepo) return 0;

  // Hot-path gate uses the read connection so it doesn't queue behind any
  // ongoing writer transactions in the poller. Two-part check:
  //   - existingCount > 0   → links exist, fast hot path
  //   - completedAt is set  → backfill ran successfully (even if it
  //                            wrote zero links because the repo
  //                            legitimately has none). Without this
  //                            marker, "linkless" repos would
  //                            re-trigger the full PR scan on every
  //                            single request.
  const readDb = getReadDb();
  const existingCount = (readDb
    .prepare(`SELECT COUNT(*) AS c FROM pr_issue_links WHERE LOWER(repo_full_name) = ?`)
    .get(normalizedRepo) as { c: number }).c;
  if (existingCount > 0) return existingCount;
  const completedAt = (readDb
    .prepare('SELECT pr_issue_links_backfilled_at FROM repo_meta WHERE LOWER(full_name) = ?')
    .get(normalizedRepo) as { pr_issue_links_backfilled_at: string | null } | undefined)
    ?.pr_issue_links_backfilled_at;
  if (completedAt) return 0;

  // Cold path: schedule the backfill OFF the request path.
  if (!inFlightLinksBackfill.has(normalizedRepo)) {
    inFlightLinksBackfill.add(normalizedRepo);
    setImmediate(() => {
      try {
        const writeDb = getDb();
        const markerRepoFullName = resolveCachedRepoFullName(writeDb, normalizedRepo, repoFullName);
        runPrIssueLinksBackfill(markerRepoFullName);
        // Persistent marker so subsequent requests don't re-schedule
        // when the repo legitimately has zero linked issues.
        writeDb
          .prepare(
            `INSERT INTO repo_meta (full_name, pr_issue_links_backfilled_at)
             VALUES (?, ?)
             ON CONFLICT(full_name) DO UPDATE SET pr_issue_links_backfilled_at = excluded.pr_issue_links_backfilled_at`,
          )
          .run(markerRepoFullName, new Date().toISOString());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[refresh] backfillPrIssueLinks(${repoFullName}) failed:`, msg);
        // Intentionally do NOT write the completed marker on failure
        // — the next request should retry rather than treat a failed
        // backfill as "ran, found nothing".
      } finally {
        inFlightLinksBackfill.delete(normalizedRepo);
      }
    });
  }
  return 0;
}

function resolveCachedRepoFullName(db: ReturnType<typeof getDb>, normalizedRepo: string, fallback: string): string {
  const pullRow = db
    .prepare('SELECT repo_full_name AS full_name FROM pulls WHERE LOWER(repo_full_name) = ? LIMIT 1')
    .get(normalizedRepo) as { full_name: string } | undefined;
  if (pullRow?.full_name) return pullRow.full_name;

  const metaRow = db
    .prepare('SELECT full_name FROM repo_meta WHERE LOWER(full_name) = ? LIMIT 1')
    .get(normalizedRepo) as { full_name: string } | undefined;
  return metaRow?.full_name ?? fallback.trim();
}

/** The actual blocking backfill body — separated so it can be invoked
 *  from the deferred path (setImmediate above) and from any future
 *  caller that genuinely wants to block until it's done (poller,
 *  migrations, tests). */
function runPrIssueLinksBackfill(repoFullName: string): number {
  const db = getDb();
  const normalizedRepo = repoFullName.trim().toLowerCase();
  const pulls = db
    .prepare(`SELECT repo_full_name, number, title, body FROM pulls WHERE LOWER(repo_full_name) = ?`)
    .all(normalizedRepo) as Array<{ repo_full_name: string; number: number; title: string; body: string | null }>;
  if (pulls.length === 0) return 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO pr_issue_links (repo_full_name, pr_number, issue_number)
     VALUES (?, ?, ?)`
  );
  let inserted = 0;
  const tx = db.transaction(() => {
    for (const pr of pulls) {
      const links = extractLinkedIssues({
        title: pr.title,
        body: pr.body,
        repo_full_name: pr.repo_full_name,
      });
      for (const l of links) {
        if (l.repo && l.repo.toLowerCase() !== normalizedRepo) continue;
        const r = insert.run(pr.repo_full_name, pr.number, l.number);
        if (r.changes > 0) inserted += 1;
      }
    }
  });
  tx();
  return inserted;
}

const ISSUE_STALE_MS = 10_000;
const PULL_STALE_MS = 10_000;

// Cap how many rows go into a single sync SQLite transaction. Smaller chunks
// = the JS event loop yields more often, so foreground requests don't block
// behind a giant upsert. Tuned so each chunk's commit is ~50–150ms.
const UPSERT_CHUNK = 50;
const yieldEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

// Upsert one fetched page in chunked sync transactions, yielding the event
// loop between chunks so foreground requests can interleave instead of
// waiting the full upsert duration. Used as the per-page sink for the
// paginated GitHub fetchers so progress is persisted as each page arrives.
async function persistInChunks<T>(rows: T[], txFn: (batch: T[]) => void): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    txFn(rows.slice(i, i + UPSERT_CHUNK));
    if (i + UPSERT_CHUNK < rows.length) await yieldEventLoop();
  }
}
// Comments are 10× more numerous than issues; let them age longer between
// refreshes since the dashboard only consults them when the user opens the
// Owner-comments tab.
const COMMENT_STALE_MS = 5 * 60_000;

const inFlightIssues = new Map<string, Promise<void>>();
const inFlightPulls = new Map<string, Promise<void>>();
const inFlightComments = new Map<string, Promise<void>>();
const lastCommentsFetch = new Map<string, number>();

function nowIso(): string {
  return new Date().toISOString();
}

function labelsToJson(labels: GhIssue['labels']): string {
  return JSON.stringify(
    labels.map((l) => (typeof l === 'string' ? { name: l } : { name: l.name ?? '', color: l.color ?? '' }))
  );
}

function upsertIssue(repoFullName: string, issue: GhIssue): void {
  const db = getDb();
  const existing = db
    .prepare('SELECT first_seen_at FROM issues WHERE repo_full_name = ? AND number = ?')
    .get(repoFullName, issue.number) as { first_seen_at: string } | undefined;

  const firstSeen = existing?.first_seen_at ?? nowIso();

  const { body: cappedBody, truncated } = capBody(issue.body, ISSUE_BODY_CAP);
  db.prepare(
    `INSERT INTO issues
     (repo_full_name, number, title, body, body_truncated, state, state_reason, author_login, author_association,
      labels, comments, created_at, updated_at, closed_at, html_url, raw_json, fetched_at, first_seen_at)
     VALUES (@repo_full_name, @number, @title, @body, @body_truncated, @state, @state_reason, @author_login, @author_association,
             @labels, @comments, @created_at, @updated_at, @closed_at, @html_url, NULL, @fetched_at, @first_seen_at)
     ON CONFLICT(repo_full_name, number) DO UPDATE SET
       title              = excluded.title,
       -- Don't let a poller sweep downgrade a complete body (e.g. one a detail
       -- open fetched in full) back to a capped slice (issue #165). Overwrite
       -- only when the incoming body is itself complete, the stored body is
       -- already truncated, or the incoming text is at least as long as what's
       -- stored (so a genuinely grown body still wins). A rarely-edited long
       -- body may go briefly stale here; that's the accepted trade for keeping
       -- the detail cache warm.
       body               = CASE
         WHEN excluded.body_truncated = 0
           OR issues.body_truncated = 1
           OR length(excluded.body) >= length(IFNULL(issues.body, ''))
         THEN excluded.body ELSE issues.body END,
       body_truncated     = CASE
         WHEN excluded.body_truncated = 0
           OR issues.body_truncated = 1
           OR length(excluded.body) >= length(IFNULL(issues.body, ''))
         THEN excluded.body_truncated ELSE issues.body_truncated END,
       state              = excluded.state,
       state_reason       = excluded.state_reason,
       author_login       = excluded.author_login,
       author_association = excluded.author_association,
       labels             = excluded.labels,
       comments           = excluded.comments,
       updated_at         = excluded.updated_at,
       closed_at          = excluded.closed_at,
       html_url           = excluded.html_url,
       raw_json           = NULL,
       fetched_at         = excluded.fetched_at`
  ).run({
    repo_full_name: repoFullName,
    number: issue.number,
    title: issue.title,
    body: cappedBody,
    body_truncated: truncated,
    state: issue.state,
    state_reason: issue.state_reason,
    author_login: issue.user?.login ?? null,
    author_association: issue.author_association ?? null,
    labels: labelsToJson(issue.labels),
    comments: issue.comments,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    closed_at: issue.closed_at,
    html_url: issue.html_url,
    fetched_at: nowIso(),
    first_seen_at: firstSeen,
  });
}

function upsertPull(repoFullName: string, pull: GhPull): void {
  const db = getDb();
  const existing = db
    .prepare('SELECT first_seen_at FROM pulls WHERE repo_full_name = ? AND number = ?')
    .get(repoFullName, pull.number) as { first_seen_at: string } | undefined;

  const firstSeen = existing?.first_seen_at ?? nowIso();
  const merged = pull.merged_at ? 1 : 0;

  const { body: truncatedBody, truncated } = capBody(pull.body, PULL_BODY_CAP);
  db.prepare(
    `INSERT INTO pulls
     (repo_full_name, number, title, body, body_truncated, state, draft, merged, author_login, author_association,
      created_at, updated_at, closed_at, merged_at, html_url, raw_json, fetched_at, first_seen_at)
     VALUES (@repo_full_name, @number, @title, @body, @body_truncated, @state, @draft, @merged, @author_login, @author_association,
             @created_at, @updated_at, @closed_at, @merged_at, @html_url, NULL, @fetched_at, @first_seen_at)
     ON CONFLICT(repo_full_name, number) DO UPDATE SET
       title              = excluded.title,
       -- See upsertIssue: never downgrade a complete body to a capped slice on
       -- a poller sweep (issue #165).
       body               = CASE
         WHEN excluded.body_truncated = 0
           OR pulls.body_truncated = 1
           OR length(excluded.body) >= length(IFNULL(pulls.body, ''))
         THEN excluded.body ELSE pulls.body END,
       body_truncated     = CASE
         WHEN excluded.body_truncated = 0
           OR pulls.body_truncated = 1
           OR length(excluded.body) >= length(IFNULL(pulls.body, ''))
         THEN excluded.body_truncated ELSE pulls.body_truncated END,
       state              = excluded.state,
       draft              = excluded.draft,
       merged             = excluded.merged,
       author_association = excluded.author_association,
       updated_at         = excluded.updated_at,
       closed_at          = excluded.closed_at,
       merged_at          = excluded.merged_at,
       html_url           = excluded.html_url,
       fetched_at         = excluded.fetched_at`
  ).run({
    repo_full_name: repoFullName,
    number: pull.number,
    title: pull.title,
    body: truncatedBody,
    body_truncated: truncated,
    state: pull.state,
    draft: pull.draft ? 1 : 0,
    merged,
    author_login: pull.user?.login ?? null,
    author_association: pull.author_association ?? null,
    created_at: pull.created_at,
    updated_at: pull.updated_at,
    closed_at: pull.closed_at,
    merged_at: pull.merged_at,
    html_url: pull.html_url,
    fetched_at: nowIso(),
    first_seen_at: firstSeen,
  });
  // Refresh the denormalized PR→issue link rows for this PR's new body/title.
  replacePrIssueLinks(repoFullName, pull.number, pull.title, truncatedBody);
}

function touchRepoMeta(repoFullName: string, field: 'last_issues_fetch' | 'last_pulls_fetch', error?: string): void {
  const db = getDb();
  const now = nowIso();
  const existing = db.prepare('SELECT full_name FROM repo_meta WHERE full_name = ?').get(repoFullName);
  if (!existing) {
    db.prepare(
      `INSERT INTO repo_meta (full_name, ${field}, last_fetch_error) VALUES (?, ?, ?)`
    ).run(repoFullName, now, error ?? null);
  } else {
    db.prepare(
      `UPDATE repo_meta SET ${field} = ?, last_fetch_error = ? WHERE full_name = ?`
    ).run(now, error ?? null, repoFullName);
  }
}

// Bump this when MAX_BOOTSTRAP_PAGES (in github.ts) grows OR when we add a
// new field to the cache that the incremental `since=` sweep won't backfill
// (e.g. `pulls.author_association` in v2). Existing rows carry an older
// version in repo_meta and will re-bootstrap on next fetch so the cache
// catches the long tail that the previous version missed.
export const BOOTSTRAP_VERSION = 2;

function markBootstrapDone(repoFullName: string, field: 'issues_bootstrap_done_at' | 'pulls_bootstrap_done_at'): void {
  const db = getDb();
  const versionField = field === 'issues_bootstrap_done_at'
    ? 'issues_bootstrap_version'
    : 'pulls_bootstrap_version';
  db.prepare(
    `UPDATE repo_meta SET ${field} = ?, ${versionField} = ? WHERE full_name = ?`
  ).run(nowIso(), BOOTSTRAP_VERSION, repoFullName);
}

// 5 minute buffer for ordinary clock drift, plus a hard floor that always
// looks back at least SINCE_FLOOR_MS. The floor prevents a one-off missed
// update (poller restart, network blip, GitHub eventual consistency) from
// permanently stranding an issue on stale data — we'd otherwise march
// `since=` past the missed event and never query for it again.
const SINCE_BUFFER_MS = 5 * 60_000;
const SINCE_FLOOR_MS = 24 * 60 * 60_000;

function incrementalSince(lastFetchIso: string | null | undefined): string | undefined {
  if (!lastFetchIso) return undefined;
  const buffered = new Date(lastFetchIso).getTime() - SINCE_BUFFER_MS;
  const floor = Date.now() - SINCE_FLOOR_MS;
  return new Date(Math.min(buffered, floor)).toISOString();
}

function upsertComment(repoFullName: string, c: GhComment): void {
  const db = getDb();
  // The comment's issue/pr number isn't on the response top-level, but the
  // last `/N` of `issue_url` always is.
  const m = c.issue_url.match(/\/(?:issues|pulls)\/(\d+)$/);
  const issueNumber = m ? Number(m[1]) : 0;
  if (!issueNumber) return;
  db.prepare(
    `INSERT INTO issue_comments
     (comment_id, repo_full_name, issue_number, author_login, author_association,
      body, html_url, created_at, updated_at, fetched_at)
     VALUES (@id, @repo, @num, @login, @assoc, @body, @url, @created, @updated, @fetched)
     ON CONFLICT(comment_id) DO UPDATE SET
       author_association = excluded.author_association,
       body               = excluded.body,
       updated_at         = excluded.updated_at,
       fetched_at         = excluded.fetched_at`
  ).run({
    id: c.id,
    repo: repoFullName,
    num: issueNumber,
    login: c.user?.login ?? null,
    assoc: c.author_association,
    body: (c.body ?? '').slice(0, 8000),
    url: c.html_url,
    created: c.created_at,
    updated: c.updated_at,
    fetched: nowIso(),
  });
}

/**
 * Refresh the issue-comments cache for a repo. Throttled by `COMMENT_STALE_MS`
 * so opening the Owner-comments tab repeatedly doesn't hammer GitHub. After
 * the first bootstrap, subsequent fetches use `since=` for cheap incremental
 * pulls.
 */
export async function refreshCommentsIfStale(owner: string, name: string, force = false): Promise<void> {
  await yieldEventLoop();
  const full = `${owner}/${name}`;
  const last = lastCommentsFetch.get(full);
  if (!force && last && Date.now() - last < COMMENT_STALE_MS) return;

  const existing = inFlightComments.get(full);
  if (existing) return existing;

  const db = getDb();
  const lastUpdated = (db
    .prepare(`SELECT MAX(updated_at) AS u FROM issue_comments WHERE repo_full_name = ?`)
    .get(full) as { u: string | null }).u;
  // Same clock-drift buffer + 24h hard floor as issues/pulls — see
  // incrementalSince() for the rationale.
  const since = incrementalSince(lastUpdated);

  const p = (async () => {
    try {
      const txFn = db.transaction((batch: GhComment[]) => {
        for (const c of batch) upsertComment(full, c);
      });
      await fetchIssueCommentsFromGithub(owner, name, since, undefined, (items) =>
        persistInChunks(items, txFn),
      );
      lastCommentsFetch.set(full, Date.now());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[comments] ${full} fetch failed: ${msg.slice(0, 200)}`);
      // Throttle retries — without this the next call immediately retries
      // because lastCommentsFetch was never set on the failed path.
      lastCommentsFetch.set(full, Date.now());
    } finally {
      inFlightComments.delete(full);
    }
  })();
  inFlightComments.set(full, p);
  return p;
}

export async function refreshIssuesIfStale(owner: string, name: string, force = false): Promise<void> {
  // Yield before any sync DB work so route handlers calling this fire-and-
  // forget can return without blocking on the writer connection.
  await yieldEventLoop();
  const full = `${owner}/${name}`;
  const db = getDb();
  const meta = db
    .prepare('SELECT last_issues_fetch, issues_bootstrap_done_at, issues_bootstrap_version FROM repo_meta WHERE full_name = ?')
    .get(full) as { last_issues_fetch: string | null; issues_bootstrap_done_at: string | null; issues_bootstrap_version: number } | undefined;

  // Bootstrap is "done" only if the cache was built with the current version's
  // page cap. Skip the staleness short-circuit when we still need to re-bootstrap.
  const bootstrapDone =
    !!meta?.issues_bootstrap_done_at && (meta?.issues_bootstrap_version ?? 0) >= BOOTSTRAP_VERSION;

  if (!force && bootstrapDone && meta?.last_issues_fetch) {
    const age = Date.now() - new Date(meta.last_issues_fetch).getTime();
    if (age < ISSUE_STALE_MS) return;
  }

  const existing = inFlightIssues.get(full);
  if (existing) return existing;
  const since = bootstrapDone ? incrementalSince(meta?.last_issues_fetch ?? null) : undefined;

  const p = (async () => {
    try {
      // Persist each page as it arrives (idempotent upserts) so a mid-
      // pagination failure keeps its partial progress instead of discarding
      // every page fetched so far. markBootstrapDone still fires only on a
      // fully-clean run, but the cache's union now grows across cycles toward
      // completeness rather than restarting from empty.
      const txFn = getDb().transaction((batch: GhIssue[]) => {
        for (const i of batch) upsertIssue(full, i);
      });
      await fetchIssuesFromGithub(owner, name, since, undefined, (issues) =>
        persistInChunks(issues, txFn),
      );
      touchRepoMeta(full, 'last_issues_fetch');
      if (!bootstrapDone) markBootstrapDone(full, 'issues_bootstrap_done_at');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      touchRepoMeta(full, 'last_issues_fetch', msg);
      throw err;
    } finally {
      inFlightIssues.delete(full);
    }
  })();

  inFlightIssues.set(full, p);
  return p;
}

export async function refreshPullsIfStale(owner: string, name: string, force = false): Promise<void> {
  await yieldEventLoop();
  const full = `${owner}/${name}`;
  const db = getDb();
  const meta = db
    .prepare('SELECT last_pulls_fetch, pulls_bootstrap_done_at, pulls_bootstrap_version FROM repo_meta WHERE full_name = ?')
    .get(full) as { last_pulls_fetch: string | null; pulls_bootstrap_done_at: string | null; pulls_bootstrap_version: number } | undefined;

  const bootstrapDone =
    !!meta?.pulls_bootstrap_done_at && (meta?.pulls_bootstrap_version ?? 0) >= BOOTSTRAP_VERSION;

  if (!force && bootstrapDone && meta?.last_pulls_fetch) {
    const age = Date.now() - new Date(meta.last_pulls_fetch).getTime();
    if (age < PULL_STALE_MS) return;
  }

  const existing = inFlightPulls.get(full);
  if (existing) return existing;
  const since = bootstrapDone ? incrementalSince(meta?.last_pulls_fetch ?? null) : undefined;

  const p = (async () => {
    try {
      // See refreshIssuesIfStale: persist per page so partial progress on a
      // large repo survives a mid-pagination failure.
      const txFn = getDb().transaction((batch: GhPull[]) => {
        for (const pr of batch) upsertPull(full, pr);
      });
      await fetchPullsFromGithub(owner, name, since, undefined, (pulls) =>
        persistInChunks(pulls, txFn),
      );
      touchRepoMeta(full, 'last_pulls_fetch');
      if (!bootstrapDone) markBootstrapDone(full, 'pulls_bootstrap_done_at');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      touchRepoMeta(full, 'last_pulls_fetch', msg);
      throw err;
    } finally {
      inFlightPulls.delete(full);
    }
  })();

  inFlightPulls.set(full, p);
  return p;
}
