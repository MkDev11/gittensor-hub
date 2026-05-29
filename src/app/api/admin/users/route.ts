import { NextResponse } from 'next/server';
import { listUsers, requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  const { user: me } = gate;
  const users = listUsers();
  return NextResponse.json({
    me: { id: me.id, github_login: me.github_login },
    users: users.map((u) => ({
      id: u.id,
      github_id: u.github_id,
      github_login: u.github_login,
      avatar_url: u.avatar_url,
      status: u.status,
      is_admin: !!u.is_admin,
      created_at: u.created_at,
      last_login_at: u.last_login_at,
      approved_at: u.approved_at,
      approved_by_id: u.approved_by_id,
    })),
  });
}
