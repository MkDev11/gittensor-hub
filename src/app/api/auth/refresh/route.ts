import { NextResponse } from 'next/server';
import { getSessionFromCookies, getUserById, setSessionCookieFor } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Re-issue the session cookie from the current DB row. Used by the
 * /pending-approval page (polls every few seconds) so that an admin's approval
 * propagates without forcing the user to sign out and in.
 */
export async function POST() {
  const sess = await getSessionFromCookies();
  if (!sess) return NextResponse.json({ authenticated: false }, { status: 401 });
  const user = getUserById(sess.uid);
  if (!user) return NextResponse.json({ authenticated: false }, { status: 401 });
  await setSessionCookieFor(user);
  return NextResponse.json({
    authenticated: true,
    id: user.id,
    username: user.github_login,
    status: user.status,
    is_admin: !!user.is_admin,
    avatar_url: user.avatar_url,
  });
}
