import { NextResponse } from 'next/server';
import { getSessionFromCookies, getUserById, pendingCount, recentPendingUsers } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sess = await getSessionFromCookies();
  if (!sess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const me = getUserById(sess.uid);
  if (!me || !me.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const count = pendingCount();
  const latest = recentPendingUsers(20).map((u) => ({
    id: u.id,
    github_login: u.github_login,
    avatar_url: u.avatar_url,
    created_at: u.created_at,
  }));
  return NextResponse.json({ count, latest });
}
