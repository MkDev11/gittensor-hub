import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/db';
import { buildEtag, etagNotModified, withEtagHeaders } from '@/lib/etag';
import { getLiveReposAsyncServer, isTrackedRepoServer } from '@/lib/repos-server';
import { getGittensorMinerLogins } from '@/lib/gittensor-miners-server';
import { computeMaintainerStats } from '@/lib/maintainer-stats';

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

  // The repo's issue-discovery share comes from the live policy snapshot; the
  // miner login set comes from the upstream validator feed (cached). Figures are
  // restricted to miners' work, so both feed into the response and the ETag.
  const [minerLogins, live] = await Promise.all([
    getGittensorMinerLogins(),
    getLiveReposAsyncServer(),
  ]);
  const issueDiscoveryShare = live.repos.find((r) => r.fullName.toLowerCase() === full.toLowerCase())?.issueDiscoveryShare ?? 0;

  // ETag keyed on the repo's last poll timestamps — stats only move when the
  // poller upserts new issue/PR data. The 30-day window drifts with wall-clock
  // (bound to the current day) and the figures depend on the miner-set size and
  // the issue-discovery share, so fold both in.
  const meta = db
    .prepare('SELECT last_issues_fetch, last_pulls_fetch FROM repo_meta WHERE full_name = ?')
    .get(full) as { last_issues_fetch: string | null; last_pulls_fetch: string | null } | undefined;
  const etag = buildEtag([
    'maintainer-stats-v2',
    full,
    meta?.last_issues_fetch,
    meta?.last_pulls_fetch,
    new Date().toISOString().slice(0, 10),
    minerLogins ? minerLogins.size : 'unfiltered',
    issueDiscoveryShare,
  ]);
  const notModified = etagNotModified(req, etag);
  if (notModified) return notModified;

  try {
    const stats = computeMaintainerStats(db, full, { minerLogins, issueDiscoveryShare });
    return NextResponse.json(stats, { headers: withEtagHeaders(etag) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[maintainer-stats] ${full} failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
