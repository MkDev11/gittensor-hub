import { NextResponse } from 'next/server';
import { getSessionFromCookies, getUserById } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sess = await getSessionFromCookies();
  if (!sess) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  const user = getUserById(sess.uid);
  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    id: user.id,
    username: user.github_login,
    status: user.status,
    is_admin: !!user.is_admin,
    avatar_url: user.avatar_url,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
  });
}
