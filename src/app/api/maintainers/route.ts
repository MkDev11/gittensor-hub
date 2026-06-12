import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/db';
import { getLiveReposAsyncServer } from '@/lib/repos-server';
import { computeMaintainerStats } from '@/lib/maintainer-stats';
import { maintainerPool } from '@/lib/incentives';
import {
  maintainerGrade,
  gradeLetter,
  headlineReviewSpeed,
  headlineIssueResponse,
  type MaintainerRepoContribution,
  type MaintainerSummary,
  type MaintainersResponse,
} from '@/lib/api-types';
import type { RepoEntry } from '@/lib/repos';
import type { Miner } from '@/types/entities';

export const dynamic = 'force-dynamic';

const MIRROR_BASE_URL = 'https://mirror.gittensor.io';
const MINERS_URL = 'https://api.gittensor.io/miners';
// The aggregation scans every repo's pulls/issues — slow-moving data, so a short
// server-side memo keeps a refresh or a few concurrent loads from re-scanning.
const CACHE_TTL_MS = 120_000;

interface RosterMaintainer {
  githubId: string | null;
  login: string;
}

interface MinerIndex {
  /** Lowercased registered miner logins — restricts stats to miner work. */
  logins: Set<string>;
  /** Registered miner GitHub ids — who earns maintainer reward. */
  registeredIds: Set<string>;
  /** id → canonical login, to name a maintainer the mirror only gave an id for. */
  loginById: Map<string, string>;
}

let cache: { at: number; payload: MaintainersResponse } | null = null;
// Single in-flight rebuild, so a refresh spike after TTL collapses onto one
// build() instead of fanning out into N DB scans + upstream fetches per caller.
let inflight: Promise<MaintainersResponse> | null = null;

function normId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const id = String(value).trim();
  return id && id !== '0' ? id : null;
}

/** Maintainer roster for one repo from the gittensor mirror. null when the
 *  mirror is unavailable, so the caller can flag rosters as incomplete. */
async function fetchRoster(owner: string, name: string): Promise<RosterMaintainer[] | null> {
  try {
    const url = `${MIRROR_BASE_URL}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/maintainers`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      maintainers?: Array<{ github_id?: string | number; githubId?: string | number; login?: string }>;
    };
    return (body.maintainers ?? [])
      .map((m) => ({ githubId: normId(m.github_id ?? m.githubId), login: (m.login ?? '').trim() }))
      .filter((m) => m.login || m.githubId);
  } catch {
    return null;
  }
}

/** Registered-miner index from the validator feed. null on outage → stats count
 *  every contributor (unfiltered) and no reward is attributed. */
async function fetchMinerIndex(): Promise<MinerIndex | null> {
  try {
    const res = await fetch(MINERS_URL, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const miners = (await res.json()) as Array<Pick<Miner, 'githubUsername' | 'githubId'>>;
    const logins = new Set<string>();
    const registeredIds = new Set<string>();
    const loginById = new Map<string, string>();
    for (const m of miners) {
      const login = (m.githubUsername ?? '').trim();
      const id = normId(m.githubId);
      if (login) logins.add(login.toLowerCase());
      if (id) {
        registeredIds.add(id);
        if (login) loginById.set(id, login);
      }
    }
    return { logins, registeredIds, loginById };
  } catch {
    return null;
  }
}

/** Stable aggregation key: GitHub id when present (survives a login change),
 *  else the lowercased login. */
function personKey(m: RosterMaintainer): string {
  return m.githubId ? `id:${m.githubId}` : `login:${m.login.toLowerCase()}`;
}

interface Accum {
  login: string;
  githubId: string | null;
  registered: boolean;
  repos: MaintainerRepoContribution[];
  mergedPrsTotal: number;
  mergedPrs30d: number;
  issuesCompletedTotal: number;
  issuesResolved30d: number;
  gradeScoreSum: number; // Σ score·sample, for the sample-weighted blend
  gradeSampleSum: number;
  rewardShare: number;
}

async function build(): Promise<MaintainersResponse> {
  const db = getReadDb();
  const [{ repos }, miners] = await Promise.all([getLiveReposAsyncServer(), fetchMinerIndex()]);

  // Active, emitting repos only — inactive/zero-emission repos have no live
  // maintainer relationship to surface.
  const active = repos.filter((r): r is RepoEntry => !r.inactiveAt && r.emissionShare > 0);
  const rosters = await Promise.all(active.map((r) => fetchRoster(r.owner, r.name)));
  const rosterAvailable = rosters.some((r) => r !== null);

  const minerLogins = miners?.logins ?? null;
  const registeredIds = miners?.registeredIds ?? new Set<string>();
  const loginById = miners?.loginById ?? new Map<string, string>();

  const people = new Map<string, Accum>();
  let repoCount = 0;

  for (let i = 0; i < active.length; i++) {
    const repo = active[i];
    const rawRoster = rosters[i];
    if (!rawRoster || rawRoster.length === 0) continue;
    // The mirror can list the same person twice for a repo (observed for
    // JSONbored/gittensory). Dedupe by person so we don't double-count their
    // throughput or inflate the reward-split denominator.
    const seenOnRepo = new Set<string>();
    const roster = rawRoster.filter((m) => {
      const k = personKey(m);
      if (seenOnRepo.has(k)) return false;
      seenOnRepo.add(k);
      return true;
    });
    repoCount++;

    const stats = computeMaintainerStats(db, repo.fullName, {
      minerLogins,
      issueDiscoveryShare: repo.issueDiscoveryShare,
    });
    const grade = maintainerGrade(stats);
    const share = stats.issueDiscoveryShare;
    const mode: MaintainerRepoContribution['mode'] = share >= 1 ? 'issue' : share > 0 ? 'mixed' : 'PR';
    const speedHours = share >= 0.5 ? headlineIssueResponse(stats).hours : headlineReviewSpeed(stats).hours;

    // Reward: split this repo's maintainer pool evenly among its registered
    // miner-maintainers (exact — distinct from the repo-attributed throughput).
    const registeredOnRepo = roster.filter((m) => m.githubId && registeredIds.has(m.githubId));
    const perReward = registeredOnRepo.length > 0 ? maintainerPool(repo) / registeredOnRepo.length : 0;

    for (const m of roster) {
      const isRegistered = Boolean(m.githubId && registeredIds.has(m.githubId));
      const reward = isRegistered ? perReward : 0;
      const contribution: MaintainerRepoContribution = {
        repo: repo.fullName,
        issueDiscoveryShare: share,
        maintainerCut: repo.maintainerCut,
        mode,
        gradeLetter: grade.letter,
        gradeScore: grade.score,
        provisional: grade.provisional,
        speedHours,
        mergedPrsTotal: stats.throughput.mergedPrsTotal,
        mergedPrs30d: stats.throughput.mergedPrs30d,
        issuesCompleted: stats.responsiveness.completedIssues,
        issuesResolved30d: stats.throughput.issuesCompleted30d,
        rewardShare: reward,
        isRegisteredMaintainer: isRegistered,
      };

      const key = personKey(m);
      const login = m.login || (m.githubId ? loginById.get(m.githubId) ?? m.githubId : 'unknown');
      let p = people.get(key);
      if (!p) {
        p = {
          login,
          githubId: m.githubId,
          registered: isRegistered,
          repos: [],
          mergedPrsTotal: 0,
          mergedPrs30d: 0,
          issuesCompletedTotal: 0,
          issuesResolved30d: 0,
          gradeScoreSum: 0,
          gradeSampleSum: 0,
          rewardShare: 0,
        };
        people.set(key, p);
      }
      if (m.login && p.login !== m.login) p.login = m.login; // prefer a real login over an id
      p.registered = p.registered || isRegistered;
      p.repos.push(contribution);
      p.mergedPrsTotal += contribution.mergedPrsTotal;
      p.mergedPrs30d += contribution.mergedPrs30d;
      p.issuesCompletedTotal += contribution.issuesCompleted;
      p.issuesResolved30d += contribution.issuesResolved30d;
      p.rewardShare += reward;
      if (grade.score != null && grade.sample > 0) {
        p.gradeScoreSum += grade.score * grade.sample;
        p.gradeSampleSum += grade.sample;
      }
    }
  }

  const maintainers: MaintainerSummary[] = Array.from(people.values())
    .map((p) => {
      const gradeScore = p.gradeSampleSum > 0 ? p.gradeScoreSum / p.gradeSampleSum : null;
      const repos = p.repos.sort((a, b) => b.rewardShare - a.rewardShare || b.mergedPrsTotal - a.mergedPrsTotal || a.repo.localeCompare(b.repo));
      return {
        login: p.login,
        githubId: p.githubId,
        registered: p.registered,
        repoCount: repos.length,
        repos,
        mergedPrsTotal: p.mergedPrsTotal,
        mergedPrs30d: p.mergedPrs30d,
        issuesCompletedTotal: p.issuesCompletedTotal,
        issuesResolved30d: p.issuesResolved30d,
        shipped30d: p.mergedPrs30d + p.issuesResolved30d,
        shippedTotal: p.mergedPrsTotal + p.issuesCompletedTotal,
        gradeScore,
        gradeLetter: gradeLetter(gradeScore),
        gradeSample: p.gradeSampleSum,
        rewardShare: p.rewardShare,
      };
    })
    // Headline order: reward first (the clearest "value"), then recent shipping.
    .sort((a, b) => b.rewardShare - a.rewardShare || b.shipped30d - a.shipped30d || b.shippedTotal - a.shippedTotal || a.login.localeCompare(b.login));

  return {
    generatedAt: new Date().toISOString(),
    minerFiltered: minerLogins != null,
    rosterAvailable,
    repoCount,
    maintainerCount: maintainers.length,
    maintainers,
  };
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }
  try {
    if (!inflight) {
      inflight = build()
        .then((payload) => {
          cache = { at: Date.now(), payload };
          return payload;
        })
        .finally(() => {
          // Clear on both success and failure so a failed build doesn't wedge
          // every later request onto the same rejected promise.
          inflight = null;
        });
    }
    const payload = await inflight;
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[maintainers] failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
