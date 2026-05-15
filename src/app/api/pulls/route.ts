import { NextRequest, NextResponse } from 'next/server';
import { getDb, PullRow } from '@/lib/db';
import { extractLinkedIssues } from '@/lib/pr-linking';

export const dynamic = 'force-dynamic';

interface AggPullRow extends Omit<PullRow, 'body'> {
  linked_issues: Array<{ repo: string; number: number }>;
}

export async function GET(_req: NextRequest) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, repo_full_name, number, title, body, state, draft, merged,
              author_login, author_association, created_at, updated_at, closed_at, merged_at,
              html_url, fetched_at, first_seen_at
       FROM pulls
       ORDER BY updated_at DESC
       LIMIT 3000`
    )
    .all() as PullRow[];

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
