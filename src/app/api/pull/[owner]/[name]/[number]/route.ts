import { NextRequest, NextResponse } from 'next/server';
import { getDb, PullRow } from '@/lib/db';
import { withRotation } from '@/lib/github';
import { assertTrackedRepo } from '@/lib/assert-tracked-repo';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const GITHUB_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
};

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ owner: string; name: string; number: string }> }
) {
  const params = await ctx.params;
  const { owner, name } = params;
  const denied = await assertTrackedRepo(owner, name);
  if (denied) return denied;
  const num = parseInt(params.number, 10);
  const repoFullName = `${owner}/${name}`;
  if (!Number.isFinite(num)) {
    return NextResponse.json({ error: 'Invalid pull request number' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const db = getDb();
  const cached = db
    .prepare(
      `SELECT id, repo_full_name, number, title, body, body_truncated, state, draft, merged,
              author_login, author_association, created_at, updated_at, closed_at, merged_at,
              html_url, fetched_at, first_seen_at
       FROM pulls WHERE repo_full_name = ? AND number = ?`
    )
    .get(repoFullName, num) as PullRow | undefined;

  // Serve from cache only when the stored body is complete, read from the
  // explicit poller-set flag rather than inferred from length (issue #165).
  if (cached && cached.body !== null && !cached.body_truncated) {
    return NextResponse.json({ ...cached, source: 'cache' }, { headers: NO_STORE_HEADERS });
  }

  try {
    const data = await withRotation(async (octokit) => {
      const resp = await octokit.pulls.get({
        owner,
        repo: name,
        pull_number: num,
        headers: GITHUB_HEADERS,
      });
      return resp.data;
    });
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO pulls
       (repo_full_name, number, title, body, body_truncated, state, draft, merged, author_login, author_association,
        created_at, updated_at, closed_at, merged_at, html_url, raw_json, fetched_at, first_seen_at)
       VALUES (@repo_full_name, @number, @title, @body, 0, @state, @draft, @merged, @author_login, @author_association,
               @created_at, @updated_at, @closed_at, @merged_at, @html_url, NULL, @fetched_at, @first_seen_at)
       ON CONFLICT(repo_full_name, number) DO UPDATE SET
         title              = excluded.title,
         -- Detail fetch returns the full, uncapped body — store it verbatim and
         -- clear the truncated flag so the poller won't clobber it (issue #165).
         body               = excluded.body,
         body_truncated     = 0,
         state              = excluded.state,
         draft              = excluded.draft,
         merged             = excluded.merged,
         author_login       = excluded.author_login,
         author_association = excluded.author_association,
         updated_at         = excluded.updated_at,
         closed_at          = excluded.closed_at,
         merged_at          = excluded.merged_at,
         html_url           = excluded.html_url,
         raw_json           = NULL,
         fetched_at         = excluded.fetched_at`
    ).run({
      repo_full_name: repoFullName,
      number: data.number,
      title: data.title,
      body: data.body ?? null,
      state: data.state,
      draft: data.draft ? 1 : 0,
      merged: data.merged ? 1 : 0,
      author_login: data.user?.login ?? null,
      author_association: data.author_association ?? null,
      created_at: data.created_at,
      updated_at: data.updated_at,
      closed_at: data.closed_at,
      merged_at: data.merged_at,
      html_url: data.html_url,
      fetched_at: now,
      first_seen_at: cached?.first_seen_at ?? now,
    });

    return NextResponse.json({
      id: data.id,
      repo_full_name: repoFullName,
      number: data.number,
      title: data.title,
      body: data.body ?? null,
      body_truncated: 0,
      state: data.state,
      draft: data.draft ? 1 : 0,
      merged: data.merged ? 1 : 0,
      author_login: data.user?.login ?? null,
      author_association: data.author_association ?? null,
      created_at: data.created_at,
      updated_at: data.updated_at,
      closed_at: data.closed_at,
      merged_at: data.merged_at,
      html_url: data.html_url,
      fetched_at: now,
      first_seen_at: cached?.first_seen_at ?? now,
      source: 'github',
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (cached) {
      return NextResponse.json({ ...cached, source: 'cache-fallback', body_fetch_error: msg }, { headers: NO_STORE_HEADERS });
    }
    return NextResponse.json({ error: msg }, { status: 404, headers: NO_STORE_HEADERS });
  }
}
