import { NextResponse } from 'next/server';
import { pendingCount, recentPendingUsers, requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  const count = pendingCount();
  const latest = recentPendingUsers(20).map((u) => ({
    id: u.id,
    github_login: u.github_login,
    avatar_url: u.avatar_url,
    created_at: u.created_at,
  }));
  return NextResponse.json({ count, latest });
}
