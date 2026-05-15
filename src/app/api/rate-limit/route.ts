import { NextResponse } from 'next/server';
import { fetchRateLimit, getAllRateLimitStatus } from '@/lib/github';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rate = await fetchRateLimit();
    return NextResponse.json({ ...rate, pats: getAllRateLimitStatus() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
