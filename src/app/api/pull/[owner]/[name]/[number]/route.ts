import { NextRequest, NextResponse } from 'next/server';
import { getDb, PullRow } from '@/lib/db';
import { getOctokit } from '@/lib/github';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { owner: string; name: string; number: string } }
) {
  const { owner, name } = params;
  const num = parseInt(params.number, 10);
  const repoFullName = `${owner}/${name}`;

  const db = getDb();
  const cached = db
    .prepare(
      `SELECT id, repo_full_name, number, title, body, state, draft, merged,
              author_login, created_at, updated_at, closed_at, merged_at,
              html_url, fetched_at, first_seen_at
       FROM pulls WHERE repo_full_name = ? AND number = ?`
    )
    .get(repoFullName, num) as PullRow | undefined;

  if (cached) {
    return NextResponse.json({ ...cached, source: 'cache' });
  }

  try {
    const octokit = getOctokit();
    const { data } = await octokit.pulls.get({ owner, repo: name, pull_number: num });
    return NextResponse.json({
      id: data.id,
      repo_full_name: repoFullName,
      number: data.number,
      title: data.title,
      body: data.body ?? null,
      state: data.state,
      draft: data.draft ? 1 : 0,
      merged: data.merged ? 1 : 0,
      author_login: data.user?.login ?? null,
      created_at: data.created_at,
      updated_at: data.updated_at,
      closed_at: data.closed_at,
      merged_at: data.merged_at,
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
