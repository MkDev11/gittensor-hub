import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/db';
import { backfillPrIssueLinksIfNeeded } from '@/lib/refresh';
import { buildEtag, etagNotModified, withEtagHeaders } from '@/lib/etag';

export const dynamic = 'force-dynamic';

/**
 * Map of issue_number → list of PRs that close/fix/resolve it. Reads from the
 * pre-computed `pr_issue_links` table and joins to `pulls` for the metadata
 * the client renders (avoids loading every PR body just to regex it on
 * every request).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ owner: string; name: string }> }
) {
  const params = await ctx.params;
  const repo = `${params.owner}/${params.name}`;
  const db = getReadDb();

  // First-call backfill so existing PRs that pre-date the link-table feature
  // don't return an empty map.
  backfillPrIssueLinksIfNeeded(repo);

  const lastPullsFetch = (db
    .prepare('SELECT last_pulls_fetch FROM repo_meta WHERE full_name = ?')
    .get(repo) as { last_pulls_fetch: string | null } | undefined)?.last_pulls_fetch;
  // Include the link-table size in the version key. Without this, late-arriving
  // GraphQL-sourced links (manual sidebar links the body regex misses)
  // wouldn't invalidate the browser cache because last_pulls_fetch hadn't
  // changed since the previous response.
  const linkCount = (db
    .prepare('SELECT COUNT(*) AS c FROM pr_issue_links WHERE repo_full_name = ?')
    .get(repo) as { c: number }).c;
  const etag = buildEtag(['related-prs-v2', repo, lastPullsFetch, linkCount]);
  const notModified = etagNotModified(req, etag);
  if (notModified) return notModified;

  const rows = db
    .prepare(
      `SELECT l.issue_number       AS issue_number,
              p.number              AS number,
              p.title               AS title,
              p.state               AS state,
              p.merged              AS merged,
              p.draft               AS draft,
              p.author_login        AS author_login
       FROM pr_issue_links l
       JOIN pulls p
         ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
       WHERE l.repo_full_name = ?`
    )
    .all(repo) as Array<{
      issue_number: number;
      number: number;
      title: string;
      state: string;
      merged: number;
      draft: number;
      author_login: string | null;
    }>;

  const byIssue: Record<
    number,
    Array<{ number: number; title: string; state: string; merged: number; draft: number; author_login: string | null }>
  > = {};
  for (const r of rows) {
    if (!byIssue[r.issue_number]) byIssue[r.issue_number] = [];
    byIssue[r.issue_number].push({
      number: r.number,
      title: r.title,
      state: r.state,
      merged: r.merged,
      draft: r.draft,
      author_login: r.author_login,
    });
  }

  return NextResponse.json({ repo, map: byIssue }, { headers: withEtagHeaders(etag) });
}
