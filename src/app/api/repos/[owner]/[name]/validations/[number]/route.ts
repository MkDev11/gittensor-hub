import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type ValidationStatus = 'valid' | 'invalid' | null;

/**
 * Per-user valid / invalid mark on an individual issue. Send `{status: null}`
 * (or `{status: 'unset'}`) to clear the mark.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ owner: string; name: string; number: string }> },
) {
  const params = await ctx.params;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const num = parseInt(params.number, 10);
  if (!Number.isFinite(num)) return NextResponse.json({ error: 'invalid number' }, { status: 400 });
  const repo = `${params.owner}/${params.name}`;

  const body = (await req.json().catch(() => ({}))) as { status?: string };
  let status: ValidationStatus;
  if (body.status === 'valid' || body.status === 'invalid') status = body.status;
  else if (body.status == null || body.status === 'unset') status = null;
  else return NextResponse.json({ error: 'invalid status' }, { status: 400 });

  const db = getDb();
  if (status === null) {
    db.prepare(
      `DELETE FROM issue_validations WHERE user_id = ? AND repo_full_name = ? AND issue_number = ?`,
    ).run(session.uid, repo, num);
  } else {
    db.prepare(
      `INSERT INTO issue_validations (user_id, repo_full_name, issue_number, status, set_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, repo_full_name, issue_number) DO UPDATE SET
         status = excluded.status,
         set_at = excluded.set_at`,
    ).run(session.uid, repo, num, status, new Date().toISOString());
  }

  return NextResponse.json({ ok: true, repo, number: num, status });
}
