import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/db';
import { buildEtag, etagNotModified, withEtagHeaders } from '@/lib/etag';
import { hydrateAuthorPullsFromGithub } from '@/lib/refresh';
import { isTrackedRepoServer } from '@/lib/repos-server';

export const dynamic = 'force-dynamic';

function githubLoginCandidate(value: string | null | undefined): string | null {
  const candidate = (value ?? '').trim().replace(/^@/, '');
  if (candidate.length < 4) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(candidate)) return null;
  return candidate;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ owner: string; name: string }> }
) {
  const params = await ctx.params;
  const full = `${params.owner}/${params.name}`;

  if (!(await isTrackedRepoServer(full))) {
    return NextResponse.json({ repo: full, author_options: [], total_authors: 0 });
  }
  const db = getReadDb();
  const url = new URL(req.url);
  const summaryOnly = url.searchParams.get('summary') === '1';

  const q = (url.searchParams.get('q') ?? '').trim();
  const repairCandidate = summaryOnly ? null : githubLoginCandidate(q);
  if (repairCandidate) {
    const cached = db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM pulls
         WHERE repo_full_name = ? AND author_login IS NOT NULL
           AND LOWER(author_login) = LOWER(?)`,
      )
      .get(full, repairCandidate) as { c: number };
    if (cached.c === 0) {
      try {
        await hydrateAuthorPullsFromGithub(params.owner, params.name, repairCandidate);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[pulls-meta] ${full} author repair failed for @${repairCandidate}: ${msg.slice(0, 160)}`);
      }
    }
  }

  const lastFetch = (db
    .prepare('SELECT last_pulls_fetch FROM repo_meta WHERE full_name = ?')
    .get(full) as { last_pulls_fetch: string | null } | undefined)?.last_pulls_fetch;
  const fingerprint = db
    .prepare(
      `SELECT COUNT(*) AS count, MAX(fetched_at) AS latest
       FROM pulls
       WHERE repo_full_name = ?`,
    )
    .get(full) as { count: number; latest: string | null };
  const etag = buildEtag([
    'pulls-meta-v3',
    full,
    lastFetch,
    fingerprint.count,
    fingerprint.latest,
    q,
    summaryOnly ? 'summary' : 'full',
  ]);
  const notModified = etagNotModified(req, etag);
  if (notModified) return notModified;

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

  return NextResponse.json(
    {
      repo: full,
      author_options: authorRows,
      total_authors,
    },
    { headers: withEtagHeaders(etag) },
  );
}
