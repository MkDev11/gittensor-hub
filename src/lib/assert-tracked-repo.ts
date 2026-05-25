import { NextResponse } from 'next/server';
import { isTrackedRepoServer } from '@/lib/repos-server';

export async function assertTrackedRepo(owner: string, name: string): Promise<NextResponse | null> {
  const allowed = await isTrackedRepoServer(`${owner}/${name}`);
  if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return null;
}
