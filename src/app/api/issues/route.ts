import { NextRequest, NextResponse } from 'next/server';
import { getReadDb, IssueRow } from '@/lib/db';
import { getIssueDiscoveryDisabledReposAsyncServer } from '@/lib/repos-server';
import { backfillPrIssueLinksIfNeeded } from '@/lib/refresh';
import { authorCredibilityForRepo, getGittensorCredibilityIndex } from '@/lib/gittensor-credibility';
import { chunk, createRequestTimer, normalizeRepoList, positiveInt, resolveRepoScope } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;
const SINCE_LIMIT = 200;
const ACTIVITY_LIMIT = 5000;

type SortKey = 'opened' | 'closed' | 'updated' | 'comments' | 'repo' | 'weight' | 'number';
type SortDir = 'asc' | 'desc';

interface LinkedPullRow {
  repo_full_name: string;
  issue_number: number;
  number: number;
  title: string;
  state: string;
  draft: number;
  merged: number;
  author_login: string | null;
  closed_at: string | null;
  merged_at: string | null;
  html_url: string | null;
}

const HAS_MERGED_PR_SQL =
  `EXISTS (SELECT 1 FROM pr_issue_links l
           JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
           WHERE l.repo_full_name = i.repo_full_name AND l.issue_number = i.number AND p.merged = 1)`;

function parseLabels(labels: string | null): unknown[] {
  if (!labels) return [];
  try {
    const parsed = JSON.parse(labels);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function groupIssueNumbersByRepo(rows: IssueRow[]): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const nums = grouped.get(row.repo_full_name) ?? [];
    nums.push(row.number);
    grouped.set(row.repo_full_name, nums);
  }
  return grouped;
}

function addStateFilter(where: string[], state: string | null) {
  if (!state || state === 'all') return;
  if (state === 'open') {
    where.push("i.state = 'open'");
    return;
  }
  if (state === 'completed') {
    where.push(`i.state = 'closed' AND UPPER(COALESCE(i.state_reason, '')) = 'COMPLETED' AND ${HAS_MERGED_PR_SQL}`);
    return;
  }
  if (state === 'not_planned') {
    where.push("i.state = 'closed' AND UPPER(COALESCE(i.state_reason, '')) = 'NOT_PLANNED'");
    return;
  }
  if (state === 'duplicate') {
    where.push("i.state = 'closed' AND UPPER(COALESCE(i.state_reason, '')) = 'DUPLICATE'");
    return;
  }
  if (state === 'closed_other') {
    where.push(
      `i.state = 'closed'
       AND UPPER(COALESCE(i.state_reason, '')) NOT IN ('NOT_PLANNED', 'DUPLICATE')
       AND NOT (UPPER(COALESCE(i.state_reason, '')) = 'COMPLETED' AND ${HAS_MERGED_PR_SQL})`,
    );
  }
}

function buildWhere({
  repos,
  q,
  since,
  activitySince,
  state,
  close,
  author,
  includeAuthor,
}: {
  repos: string[];
  q: string;
  since: string | null;
  activitySince: string | null;
  state: string | null;
  close: string | null;
  author: string | null;
  includeAuthor: boolean;
}): { sql: string; args: unknown[] } {
  const where: string[] = [];
  const args: unknown[] = [];

  where.push(`i.repo_full_name IN (${repos.map(() => '?').join(',')})`);
  args.push(...repos);

  if (since) {
    where.push('i.first_seen_at > ?');
    args.push(since);
  }

  if (activitySince) {
    where.push(`(
      COALESCE(i.created_at, '') >= ?
      OR COALESCE(i.updated_at, '') >= ?
      OR COALESCE(i.closed_at, '') >= ?
    )`);
    args.push(activitySince, activitySince, activitySince);
  }

  if (q) {
    const like = `%${q.toLowerCase()}%`;
    where.push(
      `(LOWER(i.title) LIKE ? OR CAST(i.number AS TEXT) LIKE ? OR ('#' || i.number) LIKE ? OR LOWER(COALESCE(i.author_login, '')) LIKE ? OR LOWER(i.repo_full_name) LIKE ?)`,
    );
    args.push(like, like, like, like, like);
  }

  addStateFilter(where, state);

  if (close === 'closed') where.push("i.state = 'closed'");
  else if (close === 'still_open') where.push("i.state != 'closed'");

  if (includeAuthor && author && author !== 'all') {
    where.push('LOWER(i.author_login) = ?');
    args.push(author.toLowerCase());
  }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

function latestIssueActivitySql(): string {
  return "MAX(COALESCE(i.closed_at, ''), COALESCE(i.updated_at, ''), COALESCE(i.created_at, ''), COALESCE(i.first_seen_at, ''))";
}

function orderBy(sort: SortKey, dir: SortDir, since: string | null, activitySince: string | null): string {
  if (since) return 'ORDER BY i.first_seen_at DESC';
  if (activitySince) return `ORDER BY ${latestIssueActivitySql()} DESC`;
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  const col =
    sort === 'opened'
      ? "COALESCE(i.created_at, '')"
      : sort === 'closed'
      ? "COALESCE(i.closed_at, '')"
      : sort === 'updated'
      ? "COALESCE(i.updated_at, '')"
      : sort === 'comments'
      ? 'i.comments'
      : sort === 'repo'
      ? 'LOWER(i.repo_full_name)'
      : sort === 'number'
      ? 'i.number'
      : 'COALESCE(rw.weight, 0)';

  return `ORDER BY ${col} ${direction}, LOWER(i.repo_full_name) ASC, i.number DESC`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const reqRepos = normalizeRepoList(url.searchParams.get('repos'));
  const since = url.searchParams.get('since');
  const activitySince = url.searchParams.get('activity_since');
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const state = url.searchParams.get('state');
  const close = url.searchParams.get('closed');
  const author = url.searchParams.get('author');
  const sortParam = url.searchParams.get('sort') as SortKey | null;
  const dirParam = url.searchParams.get('dir') as SortDir | null;
  const sort: SortKey =
    sortParam && ['opened', 'closed', 'updated', 'comments', 'repo', 'weight', 'number'].includes(sortParam)
      ? sortParam
      : since || activitySince
      ? 'updated'
      : 'opened';
  const dir: SortDir = dirParam === 'asc' ? 'asc' : 'desc';
  const page = positiveInt(url.searchParams.get('page'), 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, positiveInt(url.searchParams.get('pageSize'), PAGE_SIZE_DEFAULT));
  const windowMode = Boolean(since || activitySince);
  const limit = activitySince ? ACTIVITY_LIMIT : since ? SINCE_LIMIT : pageSize;
  const offset = windowMode ? 0 : (page - 1) * pageSize;
  const responsePage = windowMode ? 1 : page;
  const responsePageSize = windowMode ? limit : pageSize;
  const timer = createRequestTimer('api/issues', {
    page: responsePage,
    pageSize: responsePageSize,
    sort,
    dir,
    state: state ?? 'all',
    closed: close ?? 'all',
    author: author && author !== 'all' ? 'selected' : 'all',
    q: q ? 'yes' : 'no',
    since: Boolean(since),
    activitySince: Boolean(activitySince),
    requestedRepos: reqRepos?.length ?? 'all',
  });

  const repos = await timer.time('resolveRepos', () => resolveRepoScope(reqRepos));
  if (repos.length === 0) {
    timer.done({ repos: 0, rows: 0, count: 0 });
    return NextResponse.json({
      count: 0,
      repo_count: 0,
      page: responsePage,
      page_size: responsePageSize,
      total_pages: 1,
      authors: [],
      author_count: 0,
      issues: [],
    });
  }

  const db = getReadDb();
  const fromSql = `
    FROM issues i
    LEFT JOIN repo_weights rw ON rw.full_name = i.repo_full_name
  `;
  const filteredWhere = buildWhere({
    repos,
    q,
    since,
    activitySince,
    state,
    close,
    author,
    includeAuthor: true,
  });
  const authorWhere = buildWhere({
    repos,
    q,
    since,
    activitySince,
    state,
    close,
    author,
    includeAuthor: false,
  });

  const totals = timer.timeSync(
    'db.issueTotals',
    () =>
      db
        .prepare(
          `SELECT COUNT(*) as count, COUNT(DISTINCT i.repo_full_name) as repo_count
           ${fromSql}
           ${filteredWhere.sql}`,
        )
        .get(...filteredWhere.args) as { count: number; repo_count: number },
    { repos: repos.length },
  );

  const authorRows = timer.timeSync(
    'db.issueAuthors',
    () =>
      db
        .prepare(
          `SELECT i.author_login as login, COUNT(*) as count
           ${fromSql}
           ${authorWhere.sql}
           AND i.author_login IS NOT NULL
           GROUP BY i.author_login
           ORDER BY count DESC, LOWER(i.author_login) ASC
           LIMIT 2000`,
        )
        .all(...authorWhere.args) as Array<{ login: string; count: number }>,
    { repos: repos.length },
  );

  const rows = timer.timeSync(
    'db.issueRows',
    () =>
      db
        .prepare(
          `SELECT i.id, i.repo_full_name, i.number, i.title, NULL as body, i.state, i.state_reason,
                  i.author_login, i.author_association, i.labels, i.comments,
                  i.created_at, i.updated_at, i.closed_at, i.html_url, i.fetched_at, i.first_seen_at
           ${fromSql}
           ${filteredWhere.sql}
           ${orderBy(sort, dir, since, activitySince)}
           LIMIT ? OFFSET ?`,
        )
        .all(...filteredWhere.args, limit, offset) as IssueRow[],
    { repos: repos.length, limit, offset },
  );

  const linkedPrsByIssue = new Map<string, LinkedPullRow[]>();
  if (rows.length > 0) {
    const repoNames = Array.from(new Set(rows.map((r) => r.repo_full_name)));
    timer.timeSync(
      'db.backfillGate',
      () => {
        for (const repoFullName of repoNames) {
          try {
            backfillPrIssueLinksIfNeeded(repoFullName);
          } catch (err) {
            console.warn(`[issues] skipped PR-link backfill for ${repoFullName}:`, err);
          }
        }
      },
      { repos: repoNames.length },
    );

    const issuesByRepo = groupIssueNumbersByRepo(rows);
    timer.timeSync(
      'db.linkedPrs',
      () => {
        try {
          for (const [repoFullName, issueNumbers] of issuesByRepo) {
            for (const batch of chunk(issueNumbers, 200)) {
              const placeholders = batch.map(() => '?').join(',');
              const linkRows = db
                .prepare(
                  `SELECT l.repo_full_name, l.issue_number, p.number, p.title, p.state, p.draft, p.merged,
                          p.author_login, p.closed_at, p.merged_at, p.html_url
                   FROM pr_issue_links l
                   JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
                   WHERE l.repo_full_name = ? AND l.issue_number IN (${placeholders})
                   ORDER BY l.issue_number ASC, p.number ASC`,
                )
                .all(repoFullName, ...batch) as LinkedPullRow[];
              for (const row of linkRows) {
                const key = `${row.repo_full_name.toLowerCase()}#${row.issue_number}`;
                const list = linkedPrsByIssue.get(key) ?? [];
                list.push(row);
                linkedPrsByIssue.set(key, list);
              }
            }
          }
        } catch (err) {
          console.error(`[issues] linked-PRs join failed: ${err instanceof Error ? err.message : err}`);
        }
      },
      { rows: rows.length, repos: issuesByRepo.size },
    );
  }

  const rowRepoNames = rows.map((r) => r.repo_full_name);
  const rowRepoCount = new Set(rowRepoNames.map((r) => r.toLowerCase())).size;
  const [credibilityIndex, issueDiscoveryDisabledRepos] = rows.length > 0
    ? await Promise.all([
        timer.time('enrich.credibility', () => getGittensorCredibilityIndex(rowRepoNames), { repos: rowRepoCount }),
        timer.time('enrich.issueDiscovery', () => getIssueDiscoveryDisabledReposAsyncServer(rowRepoNames), { repos: rowRepoCount }),
      ])
    : [null, new Set<string>()];
  const totalPages = windowMode ? 1 : Math.max(1, Math.ceil(totals.count / pageSize));

  timer.done({ repos: repos.length, rows: rows.length, count: totals.count });
  return NextResponse.json({
    count: totals.count,
    repo_count: totals.repo_count,
    page: responsePage,
    page_size: responsePageSize,
    total_pages: totalPages,
    authors: authorRows,
    author_count: authorRows.length,
    issues: rows.map((r) => {
      const linkedPrs = linkedPrsByIssue.get(`${r.repo_full_name.toLowerCase()}#${r.number}`) ?? [];
      return {
        ...r,
        labels: parseLabels(r.labels),
        linked_prs: linkedPrs,
        linked_pr_count: linkedPrs.length,
        merged_pr_count: linkedPrs.filter((pr) => pr.merged === 1 || Boolean(pr.merged_at)).length,
        closed_pr_count: linkedPrs.filter((pr) => pr.merged !== 1 && !pr.merged_at && pr.state.toLowerCase() === 'closed').length,
        author_credibility: authorCredibilityForRepo(credibilityIndex, r.author_login, r.repo_full_name, {
          issueDiscoveryDisabled: issueDiscoveryDisabledRepos.has(r.repo_full_name.toLowerCase()),
        }),
      };
    }),
  });
}
