import { NextResponse } from 'next/server';
import { rejectUser, requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  const { user: me } = gate;
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const updated = rejectUser(id, me.id);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, user: updated });
}
