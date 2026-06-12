import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/db';
import { buildEtag, etagNotModified, withEtagHeaders } from '@/lib/etag';
import { isTrackedRepoServer, getLiveReposAsyncServer } from '@/lib/repos-server';
import { getGittensorMinerLogins } from '@/lib/gittensor-miners-server';
import { fetchMaintainerLogins } from '@/lib/maintainers-server';
import { computeFairnessSignals } from '@/lib/fairness-signals';

export const dynamic = 'force-dynamic';

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
      // Pass null through on a feed outage so the lib counts every contributor
      // instead of returning an empty card.
      minerLogins,
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
