import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const URL = 'https://api.gittensor.io/miners';
// Tight cache so the page's 10 s polling sees fresh upstream data; in-flight
// dedup still ensures multiple clients don't multiply upstream requests.
const TTL_MS = 5_000;

interface Cached {
  fetched_at: number;
  miners: unknown[];
}

let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;

async function refresh(): Promise<Cached> {
  const r = await fetch(URL, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const miners = (await r.json()) as unknown[];
  const next: Cached = { fetched_at: Date.now(), miners };
  cache = next;
  return next;
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.fetched_at < TTL_MS) {
    return NextResponse.json({ count: cache.miners.length, fetched_at: cache.fetched_at, source: 'cache', miners: cache.miners });
  }
  if (!inFlight) {
    inFlight = refresh().finally(() => {
      inFlight = null;
    });
  }
  try {
    const fresh = await inFlight;
    return NextResponse.json({ count: fresh.miners.length, fetched_at: fresh.fetched_at, source: 'live', miners: fresh.miners });
  } catch (err) {
    if (cache) {
      return NextResponse.json({ count: cache.miners.length, fetched_at: cache.fetched_at, source: 'stale', error: String(err), miners: cache.miners });
    }
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
