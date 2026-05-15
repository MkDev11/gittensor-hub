import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { refreshCommentsIfStale } from '@/lib/refresh';
import { buildEtag, etagNotModified, withEtagHeaders } from '@/lib/etag';

export const dynamic = 'force-dynamic';

const PAGE_SIZE_MAX = 200;
const PAGE_SIZE_DEFAULT = 50;

export async function GET(
  req: NextRequest,
  { params }: { params: { owner: string; name: string } }
) {
  const { owner, name } = params;
  const full = `${owner}/${name}`;

  // Fire-and-forget cache refresh — first hit pays a slow bootstrap, after
  // which `refreshCommentsIfStale` short-circuits for COMMENT_STALE_MS.
  refreshCommentsIfStale(owner, name).catch(() => {});

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const requestedSize = parseInt(url.searchParams.get('pageSize') ?? `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT;
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, requestedSize));
  const offset = (page - 1) * pageSize;

  const db = getDb();

  const lastUpdated = (db
    .prepare(`SELECT MAX(updated_at) AS u FROM issue_comments WHERE repo_full_name = ?`)
    .get(full) as { u: string | null }).u;
  const etag = buildEtag(['owner-comments-v1', full, lastUpdated, page, pageSize]);
  const notModified = etagNotModified(req, etag);
  if (notModified) return notModified;

  // GitHub marks a maintainer's comment with author_association='OWNER' on
  // their own repos (whether the repo is user- or org-owned).
  const total = (db
    .prepare(
      `SELECT COUNT(*) AS c FROM issue_comments
       WHERE repo_full_name = ? AND author_association = 'OWNER'`
    )
    .get(full) as { c: number }).c;

  const rows = db
    .prepare(
      `SELECT comment_id AS id, repo_full_name, issue_number, author_login,
              author_association, body, html_url, created_at, updated_at
       FROM issue_comments
       WHERE repo_full_name = ? AND author_association = 'OWNER'
       ORDER BY created_at DESC, comment_id DESC
       LIMIT ? OFFSET ?`
    )
    .all(full, pageSize, offset) as Array<{
      id: number;
      repo_full_name: string;
      issue_number: number;
      author_login: string | null;
      author_association: string | null;
      body: string | null;
      html_url: string | null;
      created_at: string | null;
      updated_at: string | null;
    }>;

  return NextResponse.json(
    {
      repo: full,
      count: total,
      comments: rows,
    },
    { headers: withEtagHeaders(etag) },
  );
}
