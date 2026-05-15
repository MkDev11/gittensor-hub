import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface Cached {
  tao_usd: number;
  alpha_tao: number;
  alpha_usd: number;
  fetched_at: number; // epoch ms
}

let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;
const TTL_MS = 60_000;

async function fetchTaoUsd(): Promise<number | null> {
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bittensor&vs_currencies=usd',
      { cache: 'no-store', signal: AbortSignal.timeout(8_000) },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { bittensor?: { usd?: number } };
    const usd = j.bittensor?.usd;
    return typeof usd === 'number' ? usd : null;
  } catch {
    return null;
  }
}

async function fetchSn74Rates(): Promise<{ tao_usd: number | null; alpha_tao: number | null; alpha_usd: number | null }> {
  // The gittensor miners endpoint already encodes the live conversion in
  // each row's alphaPerDay / taoPerDay / usdPerDay — average across miners
  // that have all three populated.
  try {
    const r = await fetch('https://api.gittensor.io/miners', {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return { tao_usd: null, alpha_tao: null, alpha_usd: null };
    const miners = (await r.json()) as Array<{
      alphaPerDay?: number;
      taoPerDay?: number;
      usdPerDay?: number;
    }>;
    let nT = 0, sT = 0, nA = 0, sA = 0, nU = 0, sU = 0;
    for (const m of miners) {
      const a = m.alphaPerDay ?? 0;
      const t = m.taoPerDay ?? 0;
      const u = m.usdPerDay ?? 0;
      if (t > 0 && u > 0) { sT += u / t; nT++; }
      if (a > 0 && t > 0) { sA += t / a; nA++; }
      if (a > 0 && u > 0) { sU += u / a; nU++; }
    }
    return {
      tao_usd: nT > 0 ? sT / nT : null,
      alpha_tao: nA > 0 ? sA / nA : null,
      alpha_usd: nU > 0 ? sU / nU : null,
    };
  } catch {
    return { tao_usd: null, alpha_tao: null, alpha_usd: null };
  }
}

async function refresh(): Promise<Cached> {
  const [coingeckoTao, sn74] = await Promise.all([fetchTaoUsd(), fetchSn74Rates()]);
  // Prefer CoinGecko for TAO/USD (more authoritative); fall back to derived.
  const tao_usd = coingeckoTao ?? sn74.tao_usd ?? 0;
  // Alpha price: prefer the alpha_usd directly; otherwise compute from alpha_tao × tao_usd.
  const alpha_tao = sn74.alpha_tao ?? 0;
  const alpha_usd = sn74.alpha_usd ?? (alpha_tao && tao_usd ? alpha_tao * tao_usd : 0);
  const next: Cached = { tao_usd, alpha_tao, alpha_usd, fetched_at: Date.now() };
  cache = next;
  return next;
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.fetched_at < TTL_MS) {
    return NextResponse.json({ ...cache, source: 'cache' });
  }
  if (!inFlight) {
    inFlight = refresh().finally(() => {
      inFlight = null;
    });
  }
  try {
    const fresh = await inFlight;
    return NextResponse.json({ ...fresh, source: 'live' });
  } catch (err) {
    if (cache) {
      // Serve stale on failure
      return NextResponse.json({ ...cache, source: 'stale', error: String(err) });
    }
    return NextResponse.json(
      { tao_usd: 0, alpha_tao: 0, alpha_usd: 0, fetched_at: now, error: String(err) },
      { status: 502 },
    );
  }
}
