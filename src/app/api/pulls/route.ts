import { NextRequest, NextResponse } from 'next/server';
import { getReadDb, PullRow } from '@/lib/db';
import { getIssueDiscoveryDisabledReposAsyncServer } from '@/lib/repos-server';
import { authorCredibilityForRepo, getGittensorCredibilityIndex } from '@/lib/gittensor-credibility';
import { getGittensorPrScoreMap, pullScoreKey } from '@/lib/gittensor-pr-scores';
import { chunk, createRequestTimer, normalizeRepoList, positiveInt, resolveRepoScope } from '@/lib/api-utils';
import type { AuthorCredibility, LinkedIssueReference, PullScore } from '@/types/entities';

export const dynamic = 'force-dynamic';

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;
const SINCE_LIMIT = 3000;

type SortKey = 'updated' | 'opened' | 'closed' | 'repo' | 'weight' | 'number';
type SortDir = 'asc' | 'desc';

interface AggPullRow extends Omit<PullRow, 'body'> {
  score: PullScore | null;
  author_credibility: AuthorCredibility | null;
}

function pullIssueMapKey(repoFullName: string, prNumber: number): string {
  return `${repoFullName}#${prNumber}`;
}

function groupPullNumbersByRepo(rows: PullRow[]): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const nums = grouped.get(row.repo_full_name) ?? [];
    nums.push(row.number);
    grouped.set(row.repo_full_name, nums);
  }
  return grouped;
}

function parseSinceIso(raw: string | null): string | null {
  if (!raw) return null;
  const sinceMs = Number(raw);
  if (Number.isFinite(sinceMs) && sinceMs > 0) return new Date(sinceMs).toISOString();
  const sinceDate = new Date(raw);
  return Number.isFinite(sinceDate.getTime()) ? sinceDate.toISOString() : null;
}

function addStateFilter(where: string[], state: string | null) {
  if (!state || state === 'all') return;
  if (state === 'open') {
    where.push("p.state = 'open' AND p.draft = 0 AND p.merged = 0");
    return;
  }
  if (state === 'draft') {
    where.push('p.draft = 1 AND p.merged = 0');
    return;
  }
  if (state === 'merged') {
    where.push('p.merged = 1');
    return;
  }
  if (state === 'closed') {
    where.push("p.state = 'closed' AND p.merged = 0");
  }
}

function buildWhere({
  repos,
  q,
  state,
  author,
  includeAuthor,
  sinceIso,
}: {
  repos: string[];
  q: string;
  state: string | null;
  author: string | null;
  includeAuthor: boolean;
  sinceIso: string | null;
}): { sql: string; args: unknown[] } {
  const where: string[] = [];
  const args: unknown[] = [];

  where.push(`p.repo_full_name IN (${repos.map(() => '?').join(',')})`);
  args.push(...repos);

  if (sinceIso) {
    where.push(`(
      COALESCE(p.created_at, '') >= ?
      OR COALESCE(p.updated_at, '') >= ?
      OR COALESCE(p.closed_at, '') >= ?
      OR COALESCE(p.merged_at, '') >= ?
    )`);
    args.push(sinceIso, sinceIso, sinceIso, sinceIso);
  }

  if (q) {
    const like = `%${q.toLowerCase()}%`;
    where.push(
      `(LOWER(p.title) LIKE ? OR CAST(p.number AS TEXT) LIKE ? OR ('#' || p.number) LIKE ? OR LOWER(COALESCE(p.author_login, '')) LIKE ? OR LOWER(p.repo_full_name) LIKE ?)`,
    );
    args.push(like, like, like, like, like);
  }

  addStateFilter(where, state);

  if (includeAuthor && author && author !== 'all') {
    where.push('LOWER(p.author_login) = ?');
    args.push(author.toLowerCase());
  }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

function latestPullActivitySql(): string {
  return "MAX(COALESCE(p.merged_at, ''), COALESCE(p.closed_at, ''), COALESCE(p.updated_at, ''), COALESCE(p.created_at, ''), COALESCE(p.first_seen_at, ''))";
}

function orderBy(sort: SortKey, dir: SortDir, sinceIso: string | null): string {
  if (sinceIso) return `ORDER BY ${latestPullActivitySql()} DESC`;
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  const col =
    sort === 'opened'
      ? "COALESCE(p.created_at, '')"
      : sort === 'closed'
      ? "COALESCE(p.merged_at, p.closed_at, '')"
      : sort === 'repo'
      ? 'LOWER(p.repo_full_name)'
      : sort === 'number'
      ? 'p.number'
      : sort === 'weight'
      ? 'COALESCE(rw.weight, 0)'
      : "COALESCE(p.updated_at, '')";

  return `ORDER BY ${col} ${direction}, LOWER(p.repo_full_name) ASC, p.number DESC`;
}

const FAST_RECENT_MAX_PER_REPO = 5_000;

const PULL_ROW_COLUMNS = `
  p.id, p.repo_full_name, p.number, p.title, NULL as body, p.state, p.draft, p.merged,
  p.author_login, p.author_association, p.created_at, p.updated_at, p.closed_at, p.merged_at,
  p.html_url, p.fetched_at, p.first_seen_at
`;

interface PullTotals {
  count: number;
  repo_count: number;
}

interface PullAuthorRow {
  login: string;
  count: number;
}

function canUseFastRecentPath({
  q,
  state,
  author,
  sinceIso,
  sort,
  dir,
  offset,
  limit,
}: {
  q: string;
  state: string | null;
  author: string | null;
  sinceIso: string | null;
  sort: SortKey;
  dir: SortDir;
  offset: number;
  limit: number;
}): boolean {
  return (
    !q &&
    (!state || state === 'all') &&
    (!author || author === 'all') &&
    !sinceIso &&
    sort === 'updated' &&
    dir === 'desc' &&
    offset + limit <= FAST_RECENT_MAX_PER_REPO
  );
}

function compareRecentPulls(a: PullRow, b: PullRow): number {
  const updated = (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
  if (updated !== 0) return updated;
  const repo = a.repo_full_name.toLowerCase().localeCompare(b.repo_full_name.toLowerCase());
  if (repo !== 0) return repo;
  return b.number - a.number;
}

function mergeAuthorRows(rows: PullAuthorRow[]): PullAuthorRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.login, (counts.get(row.login) ?? 0) + row.count);
  return Array.from(counts, ([login, count]) => ({ login, count }))
    .sort((a, b) => b.count - a.count || a.login.toLowerCase().localeCompare(b.login.toLowerCase()))
    .slice(0, 2000);
}

function readFastRecentPullPage(
  db: ReturnType<typeof getReadDb>,
  repos: string[],
  limit: number,
  offset: number,
): { totals: PullTotals; authorRows: PullAuthorRow[]; rows: PullRow[] } {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM pulls WHERE repo_full_name = ?');
  let totalCount = 0;
  let repoCount = 0;
  for (const repo of repos) {
    const count = (countStmt.get(repo) as { count: number }).count;
    if (count > 0) repoCount += 1;
    totalCount += count;
  }
  const totals = { count: totalCount, repo_count: repoCount };

  const perRepoLimit = offset + limit;
  const rowStmt = db.prepare(
    `SELECT ${PULL_ROW_COLUMNS}
     FROM pulls p
     WHERE p.repo_full_name = ?
     ORDER BY p.updated_at DESC, p.number DESC
     LIMIT ?`,
  );
  const authorStmt = db.prepare(
    `SELECT author_login as login, COUNT(*) as count
     FROM pulls
     WHERE repo_full_name = ? AND author_login IS NOT NULL
     GROUP BY author_login`,
  );
  const candidates: PullRow[] = [];
  const authorCandidates: PullAuthorRow[] = [];
  for (const repo of repos) {
    candidates.push(...(rowStmt.all(repo, perRepoLimit) as PullRow[]));
    authorCandidates.push(...(authorStmt.all(repo) as PullAuthorRow[]));
  }
  candidates.sort(compareRecentPulls);

  return {
    totals,
    authorRows: mergeAuthorRows(authorCandidates),
    rows: candidates.slice(offset, offset + limit),
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const reqRepos = normalizeRepoList(url.searchParams.get('repos'));
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const state = url.searchParams.get('state');
  const author = url.searchParams.get('author');
  const sortParam = url.searchParams.get('sort') as SortKey | null;
  const dirParam = url.searchParams.get('dir') as SortDir | null;
  const sinceIso = parseSinceIso(url.searchParams.get('since'));
  const sort: SortKey =
    sortParam && ['updated', 'opened', 'closed', 'repo', 'weight', 'number'].includes(sortParam)
      ? sortParam
      : 'updated';
  const dir: SortDir = dirParam === 'asc' ? 'asc' : 'desc';
  const page = positiveInt(url.searchParams.get('page'), 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, positiveInt(url.searchParams.get('pageSize'), PAGE_SIZE_DEFAULT));
  const sinceMode = Boolean(sinceIso);
  const limit = sinceMode ? SINCE_LIMIT : pageSize;
  const offset = sinceMode ? 0 : (page - 1) * pageSize;
  const responsePage = sinceMode ? 1 : page;
  const responsePageSize = sinceMode ? limit : pageSize;
  const timer = createRequestTimer('api/pulls', {
    page: responsePage,
    pageSize: responsePageSize,
    sort,
    dir,
    state: state ?? 'all',
    author: author && author !== 'all' ? 'selected' : 'all',
    q: q ? 'yes' : 'no',
    since: sinceMode,
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
      pulls: [],
      linked_issues_by_pull: {},
    });
  }

  const db = getReadDb();
  let totals: PullTotals;
  let authorRows: PullAuthorRow[];
  let rows: PullRow[];
  const fastRecentPath = canUseFastRecentPath({ q, state, author, sinceIso, sort, dir, offset, limit });

  if (fastRecentPath) {
    ({ totals, authorRows, rows } = timer.timeSync(
      'db.fastRecentPullPage',
      () => readFastRecentPullPage(db, repos, limit, offset),
      { repos: repos.length, limit, offset },
    ));
  } else {
    const fromSql = `
      FROM pulls p
      LEFT JOIN repo_weights rw ON rw.full_name = p.repo_full_name
    `;
    const filteredWhere = buildWhere({
      repos,
      q,
      state,
      author,
      includeAuthor: true,
      sinceIso,
    });
    const authorWhere = buildWhere({
      repos,
      q,
      state,
      author,
      includeAuthor: false,
      sinceIso,
    });

    totals = timer.timeSync(
      'db.pullTotals',
      () =>
        db
          .prepare(
            `SELECT COUNT(*) as count, COUNT(DISTINCT p.repo_full_name) as repo_count
             ${fromSql}
             ${filteredWhere.sql}`,
          )
          .get(...filteredWhere.args) as PullTotals,
      { repos: repos.length },
    );

    authorRows = timer.timeSync(
      'db.pullAuthors',
      () =>
        db
          .prepare(
            `SELECT p.author_login as login, COUNT(*) as count
             ${fromSql}
             ${authorWhere.sql}
             AND p.author_login IS NOT NULL
             GROUP BY p.author_login
             ORDER BY count DESC, LOWER(p.author_login) ASC
             LIMIT 2000`,
          )
          .all(...authorWhere.args) as PullAuthorRow[],
      { repos: repos.length },
    );

    rows = timer.timeSync(
      'db.pullRows',
      () =>
        db
          .prepare(
            `SELECT ${PULL_ROW_COLUMNS}
             ${fromSql}
             ${filteredWhere.sql}
             ${orderBy(sort, dir, sinceIso)}
             LIMIT ? OFFSET ?`,
          )
          .all(...filteredWhere.args, limit, offset) as PullRow[],
      { repos: repos.length, limit, offset },
    );
  }

  const rowRepoNames = rows.map((r) => r.repo_full_name);
  const rowRepoCount = new Set(rowRepoNames.map((r) => r.toLowerCase())).size;
  const [scoreMap, credibilityIndex, issueDiscoveryDisabledRepos] = rows.length > 0
    ? await Promise.all([
        timer.time('enrich.prScores', () => getGittensorPrScoreMap(), { rows: rows.length }),
        timer.time('enrich.credibility', () => getGittensorCredibilityIndex(rowRepoNames), { repos: rowRepoCount }),
        timer.time('enrich.issueDiscovery', () => getIssueDiscoveryDisabledReposAsyncServer(rowRepoNames), { repos: rowRepoCount }),
      ])
    : [null, null, new Set<string>()];

  const linked_issues_by_pull: Record<string, LinkedIssueReference[]> = {};
  if (rows.length > 0) {
    const pullsByRepo = groupPullNumbersByRepo(rows);
    timer.timeSync(
      'db.linkedIssues',
      () => {
        try {
          for (const [repoFullName, prNumbers] of pullsByRepo) {
            for (const batch of chunk(prNumbers, 200)) {
              const placeholders = batch.map(() => '?').join(',');
              const linkRows = db
                .prepare(
                  `SELECT l.repo_full_name, l.pr_number, i.number AS issue_number, i.title, i.state, i.state_reason, i.author_login
                   FROM pr_issue_links l
                   JOIN issues i ON i.repo_full_name = l.repo_full_name AND i.number = l.issue_number
                   WHERE l.repo_full_name = ? AND l.pr_number IN (${placeholders})
                   ORDER BY l.pr_number DESC, i.number ASC`,
                )
                .all(repoFullName, ...batch) as Array<{
                  repo_full_name: string;
                  pr_number: number;
                  issue_number: number;
                  title: string;
                  state: string;
                  state_reason: string | null;
                  author_login: string | null;
                }>;
              for (const lr of linkRows) {
                const key = pullIssueMapKey(lr.repo_full_name, lr.pr_number);
                if (!linked_issues_by_pull[key]) linked_issues_by_pull[key] = [];
                linked_issues_by_pull[key].push({
                  number: lr.issue_number,
                  title: lr.title,
                  state: lr.state,
                  state_reason: lr.state_reason,
                  author_login: lr.author_login,
                });
              }
            }
          }
        } catch (err) {
          console.error(`[pulls] linked-issues join failed: ${err instanceof Error ? err.message : err}`);
        }
      },
      { rows: rows.length, repos: pullsByRepo.size },
    );
  }

  const totalPages = sinceMode ? 1 : Math.max(1, Math.ceil(totals.count / pageSize));
  const pulls: AggPullRow[] = rows.map((r) => ({
    ...r,
    score: scoreMap?.get(pullScoreKey(r.repo_full_name, r.number)) ?? null,
    author_credibility: authorCredibilityForRepo(credibilityIndex, r.author_login, r.repo_full_name, {
      issueDiscoveryDisabled: issueDiscoveryDisabledRepos.has(r.repo_full_name.toLowerCase()),
    }),
  }));

  timer.done({ repos: repos.length, rows: rows.length, count: totals.count, mode: fastRecentPath ? 'fast' : 'filtered' });
  return NextResponse.json({
    count: totals.count,
    repo_count: totals.repo_count,
    page: responsePage,
    page_size: responsePageSize,
    total_pages: totalPages,
    authors: authorRows,
    author_count: authorRows.length,
    pulls,
    linked_issues_by_pull,
  });
}
