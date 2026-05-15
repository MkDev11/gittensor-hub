import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/db';
import { buildEtag, etagNotModified, withEtagHeaders } from '@/lib/etag';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { owner: string; name: string } }
) {
  const full = `${params.owner}/${params.name}`;
  const db = getReadDb();
  const url = new URL(req.url);
  const summaryOnly = url.searchParams.get('summary') === '1';

  const lastFetch = (db
    .prepare('SELECT last_pulls_fetch FROM repo_meta WHERE full_name = ?')
    .get(full) as { last_pulls_fetch: string | null } | undefined)?.last_pulls_fetch;
  const etag = buildEtag(['pulls-meta-v2', full, lastFetch, url.searchParams.get('q'), url.searchParams.get('mine_login'), summaryOnly ? 'summary' : 'full']);
  const notModified = etagNotModified(req, etag);
  if (notModified) return notModified;
  const mineLogin = (url.searchParams.get('mine_login') ?? '').trim();

  const q = (url.searchParams.get('q') ?? '').trim();

  const total_authors = (db
    .prepare(
      `SELECT COUNT(DISTINCT author_login) AS c
       FROM pulls WHERE repo_full_name = ? AND author_login IS NOT NULL`
    )
    .get(full) as { c: number }).c;

  const authorRows = summaryOnly
    ? []
    : q
      ? (db
          .prepare(
            `SELECT author_login AS login, COUNT(*) AS count
             FROM pulls
             WHERE repo_full_name = ? AND author_login IS NOT NULL
               AND LOWER(author_login) LIKE ?
             GROUP BY author_login
             ORDER BY count DESC`
          )
          .all(full, `%${q.toLowerCase()}%`) as Array<{ login: string; count: number }>)
      : (db
          .prepare(
            `SELECT author_login AS login, COUNT(*) AS count
             FROM pulls
             WHERE repo_full_name = ? AND author_login IS NOT NULL
             GROUP BY author_login
             ORDER BY count DESC`
          )
          .all(full) as Array<{ login: string; count: number }>);

  let mine_count: number | undefined;
  if (mineLogin) {
    mine_count = (db
      .prepare(
        `SELECT COUNT(*) AS c FROM pulls
         WHERE repo_full_name = ? AND LOWER(author_login) = ?`
      )
      .get(full, mineLogin.toLowerCase()) as { c: number }).c;
  }

  return NextResponse.json(
    {
      repo: full,
      author_options: authorRows,
      total_authors,
      ...(mine_count !== undefined ? { mine_count } : {}),
    },
    { headers: withEtagHeaders(etag) },
  );
}
