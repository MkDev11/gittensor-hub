import { NextResponse } from 'next/server';
import { demoteUser, requireAdmin, RoleError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  const { user: me } = gate;
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
