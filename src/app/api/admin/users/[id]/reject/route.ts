import { NextResponse } from 'next/server';
import { getSessionFromCookies, getUserById, rejectUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const sess = await getSessionFromCookies();
  if (!sess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const me = getUserById(sess.uid);
  if (!me || !me.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const updated = rejectUser(id, me.id);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, user: updated });
}
