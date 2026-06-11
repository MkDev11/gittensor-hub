import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/db';
import { buildEtag, etagNotModified, withEtagHeaders } from '@/lib/etag';
import { isTrackedRepoServer, getLiveReposAsyncServer } from '@/lib/repos-server';
import { getGittensorMinerLogins } from '@/lib/gittensor-miners-server';
import { computeFairnessSignals } from '@/lib/fairness-signals';

export const dynamic = 'force-dynamic';

const MIRROR_BASE_URL = 'https://mirror.gittensor.io';

/** Lowercased maintainer logins from the gittensor mirror. null when the mirror
 *  is unavailable (so the caller can flag that filtering wasn't applied). */
async function fetchMaintainerLogins(owner: string, name: string): Promise<Set<string> | null> {
  try {
    const url = `${MIRROR_BASE_URL}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/maintainers`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { maintainers?: Array<{ login?: string }> };
    const set = new Set<string>();
    for (const m of body.maintainers ?? []) {
      const u = (m.login ?? '').trim().toLowerCase();
      if (u) set.add(u);
    }
    return set;
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ owner: string; name: string }> },
) {
  const params = await ctx.params;
  const full = `${params.owner}/${params.name}`;

  if (!(await isTrackedRepoServer(full))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const db = getReadDb();

  const [minerLogins, maintainerLogins, live] = await Promise.all([
    getGittensorMinerLogins(),
    fetchMaintainerLogins(params.owner, params.name),
    getLiveReposAsyncServer(),
  ]);
  // Mode: an explicit ?mode= wins (mixed repos request each lens separately);
  // otherwise default by share — pure issue-discovery repos (share === 1) score
  // issue completions, PR merges everywhere else.
  const issueDiscoveryShare = live.repos.find((r) => r.fullName.toLowerCase() === full.toLowerCase())?.issueDiscoveryShare ?? 0;
  const modeParam = req.nextUrl.searchParams.get('mode');
  const mode: 'pr' | 'issue' = modeParam === 'issue' ? 'issue' : modeParam === 'pr' ? 'pr' : (issueDiscoveryShare >= 1 ? 'issue' : 'pr');

  const meta = db
    .prepare('SELECT last_pulls_fetch, last_issues_fetch FROM repo_meta WHERE full_name = ?')
    .get(full) as { last_pulls_fetch: string | null; last_issues_fetch: string | null } | undefined;
  const etag = buildEtag([
    'fairness-v2',
    full,
    mode,
    mode === 'issue' ? meta?.last_issues_fetch : meta?.last_pulls_fetch,
    new Date().toISOString().slice(0, 13),
    minerLogins ? [...minerLogins].sort().join(',') : 'unfiltered',
    maintainerLogins ? [...maintainerLogins].sort().join(',') : 'no-maint',
  ]);
  const notModified = etagNotModified(req, etag);
  if (notModified) return notModified;

  try {
    // cache.db stores canonical-case repo names (e.g. MkDev11/gittensor-hub), so
    // query with `full` as-is — matching computeMaintainerStats.
    const signals = computeFairnessSignals(db, full, {
      minerLogins: minerLogins ?? new Set<string>(),
      maintainerLogins,
      mode,
    });
    return NextResponse.json(signals, { headers: withEtagHeaders(etag) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[fairness] ${full} failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
