import { NextResponse } from 'next/server';
import { demoteUser, getSessionFromCookies, getUserById, RoleError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const sess = await getSessionFromCookies();
  if (!sess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const me = getUserById(sess.uid);
  if (!me || !me.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  try {
    const updated = demoteUser(id, me.id);
    return NextResponse.json({ ok: true, user: updated });
  } catch (e) {
    if (e instanceof RoleError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === 'not_found' ? 404 : 409 });
    }
    throw e;
  }
}
