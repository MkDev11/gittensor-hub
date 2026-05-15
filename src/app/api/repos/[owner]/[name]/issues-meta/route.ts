import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/db';
import { backfillPrIssueLinksIfNeeded } from '@/lib/refresh';
import { buildEtag, etagNotModified, withEtagHeaders } from '@/lib/etag';

export const dynamic = 'force-dynamic';

// Repo-wide aggregates that change infrequently (compared to the per-page
// listing). The client caches this with a longer staleTime so the dropdown +
// per-author OPEN/DONE/NP badges stay populated as the user paginates.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ owner: string; name: string }> }
) {
  const params = await ctx.params;
  const full = `${params.owner}/${params.name}`;
  const db = getReadDb();
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const summaryOnly = url.searchParams.get('summary') === '1';

  const lastFetch = (db
    .prepare('SELECT last_issues_fetch FROM repo_meta WHERE full_name = ?')
    .get(full) as { last_issues_fetch: string | null } | undefined)?.last_issues_fetch;
  // author_stats uses pr_issue_links via the linked-PR override — its row
  // count must invalidate the cache the same way last_issues_fetch does.
  const linkCount = (db
    .prepare('SELECT COUNT(*) AS c FROM pr_issue_links WHERE repo_full_name = ?')
    .get(full) as { c: number }).c;
  const etag = buildEtag(['issues-meta-v5', full, lastFetch, linkCount, q, summaryOnly ? 'summary' : 'full']);
  const notModified = etagNotModified(req, etag);
  if (notModified) return notModified;

  const total_authors = (db
    .prepare(
      `SELECT COUNT(DISTINCT author_login) AS c
       FROM issues WHERE repo_full_name = ? AND author_login IS NOT NULL`
    )
    .get(full) as { c: number }).c;

  // Counts that drive the "Collaborators" / "Contributors" pseudo-options at
  // the top of the author dropdown. We fold FIRST_TIME_CONTRIBUTOR / FIRST_TIMER
  // into the contributor bucket — for triage purposes those are all external
  // contributors and the user wants them grouped.
  const assocRow = db
    .prepare(
      `SELECT
         SUM(CASE WHEN UPPER(COALESCE(author_association,'')) = 'COLLABORATOR' THEN 1 ELSE 0 END) AS collaborator,
         SUM(CASE WHEN UPPER(COALESCE(author_association,''))
                       IN ('CONTRIBUTOR','FIRST_TIME_CONTRIBUTOR','FIRST_TIMER') THEN 1 ELSE 0 END) AS contributor
       FROM issues WHERE repo_full_name = ?`
    )
    .get(full) as { collaborator: number | null; contributor: number | null };
  const assoc_counts = {
    collaborator: assocRow.collaborator ?? 0,
    contributor: assocRow.contributor ?? 0,
  };

  // Make sure pr_issue_links is populated for this repo before we compute
  // stats — otherwise the linked-PR override below would erroneously demote
  // every Completed issue to Not planned.
  backfillPrIssueLinksIfNeeded(full);

  // Mirrors the buckets in /api/issues' state filter so the dropdown counts
  // match what the table shows. Completed = closed + state_reason='completed'
  // AND has at least one merged linked PR; everything else closed and not
  // explicitly not_planned/completed-with-merged-PR falls into `closed`.
  const HAS_MERGED_PR =
    `EXISTS (SELECT 1 FROM pr_issue_links l
             JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
             WHERE l.repo_full_name = i.repo_full_name AND l.issue_number = i.number AND p.merged = 1)`;

  // The full author list can be very large on monster repos. Let the initial
  // page load ask for just the count; the dropdown fetches the full list on
  // first open, preserving filtering capability without blocking the table.
  const buildAuthorRowsSql = (extraWhere: string) => `
    SELECT i.author_login AS login,
           COUNT(*) AS count,
           SUM(CASE WHEN i.state = 'open' THEN 1 ELSE 0 END) AS open,
           SUM(CASE WHEN i.state = 'closed'
                     AND UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                     AND ${HAS_MERGED_PR}
               THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN i.state = 'closed'
                     AND UPPER(COALESCE(i.state_reason,'')) = 'NOT_PLANNED'
               THEN 1 ELSE 0 END) AS not_planned,
           SUM(CASE WHEN i.state = 'closed'
                     AND UPPER(COALESCE(i.state_reason,'')) <> 'NOT_PLANNED'
                     AND NOT (UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                              AND ${HAS_MERGED_PR})
               THEN 1 ELSE 0 END) AS closed
    FROM issues i
    WHERE i.repo_full_name = ? AND i.author_login IS NOT NULL
      ${extraWhere}
    GROUP BY i.author_login
    ORDER BY count DESC`;

  type AuthorRow = {
    login: string;
    count: number;
    open: number;
    completed: number;
    not_planned: number;
    closed: number;
  };

  const authorRows: AuthorRow[] = summaryOnly
    ? []
    : q
      ? (db
          .prepare(buildAuthorRowsSql('AND LOWER(i.author_login) LIKE ?'))
          .all(full, `%${q.toLowerCase()}%`) as AuthorRow[])
      : (db.prepare(buildAuthorRowsSql('')).all(full) as AuthorRow[]);

  // Per-author stats moved to the per-page /api/issues response so this
  // endpoint stays fast on monster repos. Returning an empty object here
  // keeps the response shape backwards-compatible for any caller still
  // reading author_stats.
  const author_stats: Record<string, { open: number; completed: number; not_planned: number; closed: number }> = {};

  return NextResponse.json(
    { repo: full, author_options: authorRows, author_stats, total_authors, assoc_counts },
    { headers: withEtagHeaders(etag) },
  );
}
