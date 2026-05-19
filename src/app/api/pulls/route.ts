import { NextRequest, NextResponse } from 'next/server';
import { getReadDb, PullRow } from '@/lib/db';
import { extractLinkedIssues } from '@/lib/pr-linking';

export const dynamic = 'force-dynamic';

interface AggPullRow extends Omit<PullRow, 'body'> {
  linked_issues: Array<{ repo: string; number: number }>;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const hasRepoFilter = url.searchParams.has('repos');
  const repoFilter = url.searchParams.get('repos');
  const repoList = repoFilter ? repoFilter.split(',').map((repo) => repo.trim()).filter(Boolean) : [];
  const sinceMs = Number(url.searchParams.get('since'));
  const sinceIso = Number.isFinite(sinceMs) && sinceMs > 0 ? new Date(sinceMs).toISOString() : null;

  if (hasRepoFilter && repoList.length === 0) {
    return NextResponse.json({ count: 0, repo_count: 0, pulls: [] });
  }

  const whereParts: string[] = [];
  const args: Array<string> = [];
  if (repoList.length > 0) {
    whereParts.push(`LOWER(repo_full_name) IN (${repoList.map(() => '?').join(',')})`);
    args.push(...repoList.map((repo) => repo.toLowerCase()));
  }
  if (sinceIso) {
    whereParts.push(`COALESCE(updated_at, created_at, closed_at, merged_at) >= ?`);
    args.push(sinceIso);
  }
  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const db = getReadDb();
  const rows = db
    .prepare(
      `SELECT id, repo_full_name, number, title, body, state, draft, merged,
              author_login, author_association, created_at, updated_at, closed_at, merged_at,
              html_url, fetched_at, first_seen_at
       FROM pulls
       ${whereSql}
       ORDER BY updated_at DESC
       LIMIT 3000`
    )
    .all(...args) as PullRow[];

  const enriched: AggPullRow[] = rows.map((pr) => {
    const links = extractLinkedIssues({
      body: pr.body,
      title: pr.title,
      repo_full_name: pr.repo_full_name,
    });
    const linked = links.map((l) => ({ repo: l.repo ?? pr.repo_full_name, number: l.number }));
    const { body, ...rest } = pr;
    void body;
    return { ...rest, linked_issues: linked };
  });

  return NextResponse.json({
    count: enriched.length,
    repo_count: new Set(enriched.map((r) => r.repo_full_name)).size,
    pulls: enriched,
  });
}
