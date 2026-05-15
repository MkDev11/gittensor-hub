import { NextRequest, NextResponse } from 'next/server';
import { getDb, PullRow } from '@/lib/db';
import { extractLinkedIssues } from '@/lib/pr-linking';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { owner: string; name: string; number: string } }
) {
  const repo = `${params.owner}/${params.name}`;
  const issueNum = parseInt(params.number, 10);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, repo_full_name, number, title, body, state, draft, merged,
              author_login, created_at, updated_at, closed_at, merged_at,
              html_url, fetched_at, first_seen_at
       FROM pulls
       WHERE repo_full_name = ?`
    )
    .all(repo) as PullRow[];

  const related = rows.filter((pr) => {
    if (!pr.body && !pr.title) return false;
    const links = extractLinkedIssues({
      body: pr.body,
      title: pr.title,
      repo_full_name: pr.repo_full_name,
    });
    return links.some(
      (l) => l.number === issueNum && (l.repo === null || l.repo?.toLowerCase() === repo.toLowerCase())
    );
  });

  return NextResponse.json({
    repo,
    issue_number: issueNum,
    count: related.length,
    pulls: related,
  });
}
