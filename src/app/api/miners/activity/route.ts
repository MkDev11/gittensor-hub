import { NextResponse } from 'next/server';
import type { Miner, MinerRepoEvaluation, MinersResponse } from '@/types/entities';

export const dynamic = 'force-dynamic';

const MINERS_URL = 'https://api.gittensor.io/miners';
const REPOS_URL = 'https://api.gittensor.io/dash/repos';
const REPO_MINERS_URL_BASE = 'https://api.gittensor.io/repos';
const MAINTAINERS_URL_BASE = 'https://mirror.gittensor.io/api/v1/repos';
const TTL_MS = 30_000;
const MAINT_TTL_MS = 300_000; // maintainer rosters are near-static — cache 5 min
const CONCURRENCY = 4;
/** Fraction of a repo's emission paid to OSS contributors (the rest is the
 *  protocol treasury). Matches the repositories page incentive model so per-repo
 *  TAO numbers agree across both surfaces. */
const OSS_POOL = 0.9;

interface UpstreamRepo {
  fullName?: string | null;
  full_name?: string | null;
  config?: {
    issueDiscoveryShare?: number | string | null;
    maintainerCut?: number | string | null;
    emissionShare?: number | string | null;
    /** Per-repo eligibility overrides (validator config). Absent fields fall back
     * to the subnet defaults on the client. snake_case to match upstream. */
    eligibility?: {
      min_credibility?: number | string | null;
      min_issue_credibility?: number | string | null;
      min_valid_merged_prs?: number | string | null;
      min_valid_solved_issues?: number | string | null;
    } | null;
  } | null;
}

/** A per-repo evaluation row stamped with its repo's issue-discovery emission
 * share and the contributor's PR / issue TAO share for this repo (each a
 * fraction of the live subnet TAO — the client multiplies by subnetTAO to get
 * the per-repo emission, matching the repositories page). */
type StampedRow = MinerRepoEvaluation & {
  issueDiscoveryShare?: number;
  /** Repo's emission share (fraction of the OSS pool) — surfaced so the card can
   * show how lucrative a repo is, explaining the score-vs-earnings gap. */
  emissionShare?: number;
  prTaoShare?: number;
  issueTaoShare?: number;
  /** Per-repo eligibility thresholds from the validator config. Null when the repo
   * uses subnet defaults — the client then applies its own default floors (one
   * source of truth), so a configured 0 (no gate, e.g. entrius/oc-1) is preserved
   * distinctly from "unset". */
  minPrCred?: number | null;
  minIssueCred?: number | null;
  minMergedPrs?: number | null;
  minSolvedIssues?: number | null;
};

type MinerWire = Miner & {
  github_username?: string;
  github_id?: string | number;
  isMaintainer?: boolean;
  maintainerRepos?: string[];
  maintainerCut?: number;
  /** Maintainer-cut emission as a fraction of the subnet TAO (sum over the
   * miner's paid repos of OSS_POOL × emissionShare × maintainerCut ÷
   * maintainerCount). The client multiplies by subnetTAO to get TAO/day. */
  maintainerTaoShare?: number;
  /** Per-repo maintainer-cut share (repo full name → fraction of subnet TAO),
   * so each maintained repo can show its own maintainer emission. */
  maintainerRepoTaoShares?: Record<string, number>;
};

interface Cached {
  fetched_at: number;
  miners: Miner[];
}

let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;
// Maintainer rosters change rarely, so they get their own longer-lived cache,
// independent of the 30s miner-feed cache (avoids hammering the mirror).
let maintainerCache: { fetched_at: number; byLogin: Map<string, string[]>; count: Map<string, number> } | null = null;

function num(value: unknown): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Like num(), but preserves "absent" as null — so a config override of 0 (a real
 * "no gate" value) stays distinct from an unset field (client applies the default). */
function numOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function normalizedRepoName(value: unknown): string | null {
  const repo = stringValue(value);
  return repo.includes('/') ? repo : null;
}

function minerKeyFromFields(githubId: unknown, githubUsername: unknown, uid: unknown): string {
  const id = stringValue(githubId);
  if (id) return `id:${id}`;
  const login = stringValue(githubUsername).toLowerCase();
  if (login) return `login:${login}`;
  const uidString = stringValue(uid);
  return uidString ? `uid:${uidString}` : '';
}

function minerKey(miner: Miner): string {
  const wire = miner as MinerWire;
  return minerKeyFromFields(miner.githubId ?? wire.github_id, miner.githubUsername ?? wire.github_username, miner.uid);
}

function repoRowKey(row: MinerRepoEvaluation): string {
  return minerKeyFromFields(row.githubId ?? row.github_id, row.githubUsername ?? row.github_username, row.uid);
}

function isRepoSignal(row: MinerRepoEvaluation): boolean {
  return (
    (row.isEligible ?? row.is_eligible) === true ||
    (row.isIssueEligible ?? row.is_issue_eligible) === true ||
    num(row.totalScore ?? row.total_score) > 0 ||
    num(row.issueDiscoveryScore ?? row.issue_discovery_score) > 0 ||
    num(row.baseTotalScore ?? row.base_total_score) > 0 ||
    num(row.totalCollateralScore ?? row.total_collateral_score) > 0 ||
    num(row.totalPrs ?? row.total_prs) > 0 ||
    num(row.totalMergedPrs ?? row.total_merged_prs) > 0 ||
    num(row.totalOpenPrs ?? row.total_open_prs) > 0 ||
    num(row.totalClosedPrs ?? row.total_closed_prs) > 0 ||
    num(row.totalSolvedIssues ?? row.total_solved_issues) > 0 ||
    num(row.totalOpenIssues ?? row.total_open_issues) > 0 ||
    num(row.totalClosedIssues ?? row.total_closed_issues) > 0 ||
    num(row.usdPerDay ?? row.usd_per_day) > 0 ||
    num(row.taoPerDay ?? row.tao_per_day) > 0
  );
}

async function fetchJson<T>(url: string, timeout = 15_000): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`upstream ${url} ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchRepoRows(fullName: string): Promise<MinerRepoEvaluation[]> {
  const raw = await fetchJson<unknown>(`${REPO_MINERS_URL_BASE}/${encodeURIComponent(fullName)}/miners`, 10_000);
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { miners?: unknown }).miners)
      ? (raw as { miners: unknown[] }).miners
      : [];

  const repoKey = fullName.toLowerCase();
  return rows
    .filter((row): row is MinerRepoEvaluation => Boolean(row) && typeof row === 'object')
    .map((row) => ({ repositoryFullName: fullName, ...row }))
    .filter((row) => {
      const rowRepo = normalizedRepoName(row.repositoryFullName ?? row.repository_full_name);
      return (!rowRepo || rowRepo.toLowerCase() === repoKey) && Boolean(repoRowKey(row)) && isRepoSignal(row);
    });
}

async function mapConcurrent<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const current = index;
        index += 1;
        if (current >= items.length) return;
        results[current] = await worker(items[current]);
      }
    }),
  );

  return results;
}

/** Maintainer GitHub logins (lowercased) for a repo, from the mirror. Returns
 * null on a failed fetch (vs [] for a genuinely empty roster) so the caller can
 * avoid caching the gap during a mirror outage; the feed itself never breaks. */
async function fetchRepoMaintainers(repo: string): Promise<string[] | null> {
  const [owner, name] = repo.split('/');
  if (!owner || !name) return [];
  try {
    const url = `${MAINTAINERS_URL_BASE}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/maintainers`;
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    const list = Array.isArray(body)
      ? body
      : Array.isArray((body as { maintainers?: unknown[] })?.maintainers)
        ? (body as { maintainers: unknown[] }).maintainers
        : [];
    const logins = list
      .map((m) => {
        if (typeof m === 'string') return m;
        const o = (m ?? {}) as Record<string, unknown>;
        return stringValue(o.login ?? o.username ?? o.githubUsername ?? o.github_username);
      })
      .map((login) => login.toLowerCase())
      .filter(Boolean);
    return [...new Set(logins)]; // rosters can list a maintainer more than once
  } catch {
    return null;
  }
}

/** login (lowercased) → repos they maintain, across all tracked repos. Cached
 * separately from the miner feed (5 min) since maintainer lists rarely change. */
async function getMaintainerMap(repoNames: string[]): Promise<{ byLogin: Map<string, string[]>; count: Map<string, number> }> {
  if (maintainerCache && Date.now() - maintainerCache.fetched_at < MAINT_TTL_MS) {
    return { byLogin: maintainerCache.byLogin, count: maintainerCache.count };
  }
  const perRepo = await mapConcurrent(repoNames, CONCURRENCY, async (repo) => ({
    repo,
    logins: await fetchRepoMaintainers(repo),
  }));
  const byLogin = new Map<string, string[]>();
  const count = new Map<string, number>();
  for (const { repo, logins } of perRepo) {
    if (!logins) continue; // failed fetch — skip, don't treat as "no maintainers"
    count.set(repo.toLowerCase(), logins.length);
    for (const login of logins) {
      const repos = byLogin.get(login) ?? [];
      repos.push(repo);
      byLogin.set(login, repos);
    }
  }
  // Don't cache a roster built on failed fetches: a transient mirror outage would
  // otherwise suppress maintainer attribution for the whole TTL. On a TOTAL outage
  // keep serving the last-good roster; on a partial one, use what we got but
  // re-fetch next time instead of caching the gap.
  const anyFailed = perRepo.some((r) => r.logins === null);
  const allFailed = perRepo.length > 0 && perRepo.every((r) => r.logins === null);
  if (allFailed && maintainerCache) return { byLogin: maintainerCache.byLogin, count: maintainerCache.count };
  if (!anyFailed) maintainerCache = { fetched_at: Date.now(), byLogin, count };
  return { byLogin, count };
}

async function refresh(): Promise<Cached> {
  const [miners, reposRaw] = await Promise.all([
    fetchJson<Miner[]>(MINERS_URL),
    fetchJson<UpstreamRepo[]>(REPOS_URL),
  ]);
  const repos = reposRaw
    .map((repo) => {
      const elig = repo.config?.eligibility ?? null;
      return {
        name: normalizedRepoName(repo.fullName ?? repo.full_name),
        issueDiscoveryShare: num(repo.config?.issueDiscoveryShare),
        maintainerCut: num(repo.config?.maintainerCut),
        emissionShare: num(repo.config?.emissionShare),
        // Per-repo eligibility floors — null when the repo uses subnet defaults, so
        // the client applies its own defaults (a configured 0 is kept distinct).
        minPrCred: numOrNull(elig?.min_credibility),
        minIssueCred: numOrNull(elig?.min_issue_credibility),
        minMergedPrs: numOrNull(elig?.min_valid_merged_prs),
        minSolvedIssues: numOrNull(elig?.min_valid_solved_issues),
      };
    })
    .filter((repo): repo is typeof repo & { name: string } => Boolean(repo.name));
  const repoCut = new Map(repos.map((repo) => [repo.name.toLowerCase(), repo.maintainerCut]));
  const repoShare = new Map(repos.map((repo) => [repo.name.toLowerCase(), repo.emissionShare]));

  const minerByKey = new Map<string, MinerWire>();
  for (const miner of miners) {
    const key = minerKey(miner);
    if (!key) continue;
    minerByKey.set(key, { ...miner, repoEvaluations: [] });
  }

  const [repoResults, maintainers] = await Promise.all([
    mapConcurrent(repos, CONCURRENCY, async (repo) => {
      try {
        const rows = await fetchRepoRows(repo.name);
        // Per-repo TAO-share stamping — the repositories page's incentive model.
        // A repo's contributor pool is OSS_POOL × emissionShare × (1 − cut),
        // split into a PR pool (× (1 − issueShare)) and an issue-discovery pool
        // (× issueShare). Each eligible contributor's slice is their score over
        // the SUM of all eligible scores on this repo (the true on-chain share,
        // not a top-N display subset). We stamp the resulting fraction-of-subnet-
        // TAO on each row so the client only multiplies by the live subnet TAO.
        const q = repo.issueDiscoveryShare;
        const prPoolShare = OSS_POOL * repo.emissionShare * (1 - repo.maintainerCut) * (1 - q);
        const issuePoolShare = OSS_POOL * repo.emissionShare * (1 - repo.maintainerCut) * q;
        let prScoreSum = 0;
        let issueScoreSum = 0;
        for (const row of rows) {
          if ((row.isEligible ?? row.is_eligible) === true) prScoreSum += num(row.totalScore ?? row.total_score);
          if ((row.isIssueEligible ?? row.is_issue_eligible) === true)
            issueScoreSum += num(row.issueDiscoveryScore ?? row.issue_discovery_score);
        }
        for (const row of rows) {
          const stamped = row as StampedRow;
          stamped.issueDiscoveryShare = q;
          stamped.emissionShare = repo.emissionShare;
          // Per-repo eligibility floors (null = use client defaults).
          stamped.minPrCred = repo.minPrCred;
          stamped.minIssueCred = repo.minIssueCred;
          stamped.minMergedPrs = repo.minMergedPrs;
          stamped.minSolvedIssues = repo.minSolvedIssues;
          const prEligible = (row.isEligible ?? row.is_eligible) === true;
          const issueEligible = (row.isIssueEligible ?? row.is_issue_eligible) === true;
          stamped.prTaoShare =
            prEligible && prScoreSum > 0 ? prPoolShare * (num(row.totalScore ?? row.total_score) / prScoreSum) : 0;
          stamped.issueTaoShare =
            issueEligible && issueScoreSum > 0
              ? issuePoolShare * (num(row.issueDiscoveryScore ?? row.issue_discovery_score) / issueScoreSum)
              : 0;
        }
        return { rows, failed: false };
      } catch {
        return { rows: [] as MinerRepoEvaluation[], failed: true };
      }
    }),
    getMaintainerMap(repos.map((repo) => repo.name)),
  ]);
  if (repos.length > 0 && repoResults.every((result) => result.failed)) {
    throw new Error('all upstream repo miner fetches failed');
  }

  for (const row of repoResults.flatMap((result) => result.rows)) {
    const key = repoRowKey(row);
    if (!key) continue;
    const miner = minerByKey.get(key);
    if (miner) {
      const existing = Array.isArray(miner.repoEvaluations) ? miner.repoEvaluations : [];
      miner.repoEvaluations = [...existing, row];
      continue;
    }

    const fallbackMiner: MinerWire = {
      id: key,
      uid: Math.trunc(num(row.uid)),
      hotkey: '',
      githubUsername: stringValue(row.githubUsername ?? row.github_username ?? row.githubId ?? row.github_id),
      githubId: stringValue(row.githubId ?? row.github_id),
      isEligible: (row.isEligible ?? row.is_eligible) === true,
      isIssueEligible: (row.isIssueEligible ?? row.is_issue_eligible) === true,
      failedReason: null,
      credibility: String(num(row.credibility)),
      issueCredibility: String(num(row.issueCredibility ?? row.issue_credibility)),
      issueDiscoveryScore: String(num(row.issueDiscoveryScore ?? row.issue_discovery_score)),
      issueTokenScore: String(num(row.issueTokenScore ?? row.issue_token_score)),
      totalScore: String(num(row.totalScore ?? row.total_score)),
      baseTotalScore: String(num(row.baseTotalScore ?? row.base_total_score)),
      totalSolvedIssues: num(row.totalSolvedIssues ?? row.total_solved_issues),
      totalValidSolvedIssues: num(row.totalValidSolvedIssues ?? row.total_valid_solved_issues),
      totalOpenIssues: num(row.totalOpenIssues ?? row.total_open_issues),
      totalClosedIssues: num(row.totalClosedIssues ?? row.total_closed_issues),
      totalOpenPrs: num(row.totalOpenPrs ?? row.total_open_prs),
      totalClosedPrs: num(row.totalClosedPrs ?? row.total_closed_prs),
      totalMergedPrs: num(row.totalMergedPrs ?? row.total_merged_prs),
      totalPrs: num(row.totalPrs ?? row.total_prs),
      uniqueReposCount: 1,
      alphaPerDay: num(row.alphaPerDay ?? row.alpha_per_day),
      taoPerDay: num(row.taoPerDay ?? row.tao_per_day),
      usdPerDay: num(row.usdPerDay ?? row.usd_per_day),
      repoEvaluations: [row],
    };
    minerByKey.set(key, fallbackMiner);
  }

  // Flag maintainers (by GitHub login) so the derivation layer can surface
  // maintainer-cut earnings — a reward stream distinct from PRs / issue discovery.
  for (const miner of minerByKey.values()) {
    const login = stringValue(miner.githubUsername ?? miner.github_username).toLowerCase();
    const maintainerRepos = login ? maintainers.byLogin.get(login) : undefined;
    if (maintainerRepos && maintainerRepos.length > 0) {
      // Only repos that actually pay a maintainer cut (> 0) count — a GitHub
      // maintainer of a 0-cut repo earns nothing from maintaining it.
      const paidRepos = maintainerRepos.filter((repo) => (repoCut.get(repo.toLowerCase()) ?? 0) > 0);
      if (paidRepos.length > 0) {
        miner.isMaintainer = true;
        miner.maintainerRepos = paidRepos;
        miner.maintainerCut = Math.max(...paidRepos.map((repo) => repoCut.get(repo.toLowerCase()) ?? 0));
        // Maintainer-cut emission as a fraction of subnet TAO: each paid repo pays
        // OSS_POOL × emissionShare × maintainerCut, split across its maintainers
        // (matching the repositories page). Kept per-repo so each maintained repo
        // can show its own maintainer emission, plus summed for the split bar; the
        // client multiplies by the live subnet TAO.
        const repoShares: Record<string, number> = {};
        for (const repo of paidRepos) {
          const key = repo.toLowerCase();
          const share = repoShare.get(key) ?? 0;
          const cut = repoCut.get(key) ?? 0;
          const maintainerCount = Math.max(1, maintainers.count.get(key) ?? 1);
          repoShares[repo] = (OSS_POOL * share * cut) / maintainerCount;
        }
        miner.maintainerRepoTaoShares = repoShares;
        miner.maintainerTaoShare = Object.values(repoShares).reduce((sum, value) => sum + value, 0);
      }
    }
  }

  const next: Cached = {
    fetched_at: Date.now(),
    miners: [...minerByKey.values()],
  };
  cache = next;
  return next;
}

function payload(cached: Cached, source: 'live' | 'cache' | 'stale', error?: string): MinersResponse & { error?: string } {
  return {
    count: cached.miners.length,
    fetched_at: cached.fetched_at,
    source,
    miners: cached.miners,
    ...(error ? { error } : {}),
  };
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.fetched_at < TTL_MS) {
    return NextResponse.json(payload(cache, 'cache'));
  }

  if (!inFlight) {
    inFlight = refresh().finally(() => {
      inFlight = null;
    });
  }

  try {
    const fresh = await inFlight;
    return NextResponse.json(payload(fresh, 'live'));
  } catch (err) {
    if (cache) return NextResponse.json(payload(cache, 'stale', String(err)));
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
