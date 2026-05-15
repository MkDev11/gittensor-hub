import { NextRequest, NextResponse } from 'next/server';
import { getDb, IssueRow } from '@/lib/db';
import { getOctokit } from '@/lib/github';
import { refreshIssueLinkedPrsIfStale } from '@/lib/refresh';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { owner: string; name: string; number: string } }
) {
  const { owner, name } = params;
  const num = parseInt(params.number, 10);
  const repoFullName = `${owner}/${name}`;

  // Opportunistic GraphQL fetch of authoritative linked-PR refs for this
  // issue (catches manual sidebar links + parenthetical mentions the body
  // regex misses). Fire-and-forget — the user's response isn't blocked.
  if (Number.isFinite(num)) {
    refreshIssueLinkedPrsIfStale(owner, name, num).catch(() => {});
  }

  // 1. Try cache first.
  const db = getDb();
  const cached = db
    .prepare(
      `SELECT id, repo_full_name, number, title, body, state, state_reason,
              author_login, author_association, labels, comments,
              created_at, updated_at, closed_at, html_url, fetched_at, first_seen_at
       FROM issues WHERE repo_full_name = ? AND number = ?`
    )
    .get(repoFullName, num) as IssueRow | undefined;

  if (cached) {
    return NextResponse.json({
      ...cached,
      labels: cached.labels ? JSON.parse(cached.labels) : [],
      source: 'cache',
    });
  }

  // 2. Fall back to a direct GitHub fetch.
  try {
    const octokit = getOctokit();
    const { data } = await octokit.issues.get({ owner, repo: name, issue_number: num });
    return NextResponse.json({
      id: data.id,
      repo_full_name: repoFullName,
      number: data.number,
      title: data.title,
      body: data.body ?? null,
      state: data.state,
      state_reason: data.state_reason ?? null,
      author_login: data.user?.login ?? null,
      author_association: data.author_association ?? null,
      labels: (data.labels ?? []).map((l) =>
        typeof l === 'string' ? { name: l } : { name: l.name ?? '', color: l.color ?? '' }
      ),
      comments: data.comments,
      created_at: data.created_at,
      updated_at: data.updated_at,
      closed_at: data.closed_at,
      html_url: data.html_url,
      fetched_at: new Date().toISOString(),
      first_seen_at: new Date().toISOString(),
      source: 'github',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
