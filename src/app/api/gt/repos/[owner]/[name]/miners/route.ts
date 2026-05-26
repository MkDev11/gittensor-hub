import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/db';
import { backfillPrIssueLinksIfNeeded } from '@/lib/refresh';

export const dynamic = 'force-dynamic';

const MINERS_URL = 'https://api.gittensor.io/miners';
const REPOS_URL = 'https://api.gittensor.io/dash/repos';
const REPO_EVALS_URL_BASE = 'https://api.gittensor.io/repos';
const TTL_MS = 30_000;
const TOP_ISSUE_DISCOVERY_LIMIT = 5;

interface UpstreamMiner {
  id: string;
  githubUsername: string;
  githubId?: string | null;
  totalScore?: string | number | null;
  uid?: string | number | null;
}

interface UpstreamRepoMiner {
  id?: string | number | null;
  uid?: string | number | null;
  repositoryFullName?: string | null;
  repository_full_name?: string | null;
  githubUsername?: string | null;
  github_username?: string | null;
  githubId?: string | number | null;
  github_id?: string | number | null;
  credibility?: string | number | null;
  repoCredibility?: string | number | null;
  repo_credibility?: string | number | null;
  prCredibility?: string | number | null;
  pr_credibility?: string | number | null;
  baseTotalScore?: string | number | null;
  base_total_score?: string | number | null;
  totalScore?: string | number | null;
  total_score?: string | number | null;
  totalCollateralScore?: string | number | null;
  total_collateral_score?: string | number | null;
  totalOpenPrs?: string | number | null;
  total_open_prs?: string | number | null;
  totalClosedPrs?: string | number | null;
  total_closed_prs?: string | number | null;
  totalMergedPrs?: string | number | null;
  total_merged_prs?: string | number | null;
  totalPrs?: string | number | null;
  total_prs?: string | number | null;
  isEligible?: boolean | null;
  is_eligible?: boolean | null;
  failedReason?: string | null;
  failed_reason?: string | null;
  alphaPerDay?: string | number | null;
  alpha_per_day?: string | number | null;
  taoPerDay?: string | number | null;
  tao_per_day?: string | number | null;
  usdPerDay?: string | number | null;
  usd_per_day?: string | number | null;
}

interface UpstreamRepo {
  fullName: string;
  config?: { issueDiscoveryShare?: string | number | null; issue_discovery_share?: string | number | null } | null;
  issueDiscoveryShare?: string | number | null;
  issue_discovery_share?: string | number | null;
}

interface CachedShared {
  fetched_at: number;
  miners: UpstreamMiner[];
  issueDiscoveryShareByRepo: Map<string, number>;
  ossRankByGithubId: Map<string, number>;
}

let cache: CachedShared | null = null;
let inFlight: Promise<CachedShared> | null = null;

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`upstream ${url} ${response.status}`);
  return response.json() as Promise<T>;
}

function issueDiscoveryReason(row: {
  issueCount: number;
  maintainerIssueCount: number;
  ownerIssueCount: number;
  solvedIssueCount: number;
  sameAuthorSolvedCount: number;
  candidateIssueCount: number;
  issueDiscoveryEnabled: boolean;
}): string {
  if (!row.issueDiscoveryEnabled) return 'issue discovery disabled for repo';
  if (row.candidateIssueCount > 0) return 'can score';
  if (row.ownerIssueCount > 0) return 'repo owner cannot earn issue score';
  if (row.maintainerIssueCount > 0) return 'maintainer cannot earn issue score';
  if (row.solvedIssueCount === 0) return 'no solved issue with merged PR';
  if (row.sameAuthorSolvedCount > 0) return 'same author as solving PR';
  return 'not first issue for solving PR';
}

async function refresh(): Promise<CachedShared> {
  const [miners, repos] = await Promise.all([
    fetchJson<UpstreamMiner[]>(MINERS_URL),
    fetchJson<UpstreamRepo[]>(REPOS_URL),
  ]);
  const issueDiscoveryShareByRepo = new Map<string, number>();
  for (const repo of repos) {
    issueDiscoveryShareByRepo.set(
      repo.fullName.toLowerCase(),
      num(repo.config?.issueDiscoveryShare ?? repo.config?.issue_discovery_share ?? repo.issueDiscoveryShare ?? repo.issue_discovery_share),
    );
  }
  const ossRanked = [...miners].sort((a, b) => num(b.totalScore) - num(a.totalScore));
  const ossRankByGithubId = new Map<string, number>();
  ossRanked.forEach((m, i) => { if (m.githubId) ossRankByGithubId.set(m.githubId, i + 1); });
  const next: CachedShared = { fetched_at: Date.now(), miners, issueDiscoveryShareByRepo, ossRankByGithubId };
  cache = next;
  return next;
}

async function getShared(): Promise<CachedShared> {
  const now = Date.now();
  if (cache && now - cache.fetched_at < TTL_MS) return cache;
  if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
  return inFlight;
}

const repoMinersCache = new Map<string, { fetched_at: number; rows: UpstreamRepoMiner[] }>();
const repoMinersInFlight = new Map<string, Promise<UpstreamRepoMiner[]>>();

async function fetchRepoMiners(fullName: string): Promise<UpstreamRepoMiner[]> {
  const key = fullName.toLowerCase();
  const now = Date.now();
  const cached = repoMinersCache.get(key);
  if (cached && now - cached.fetched_at < TTL_MS) return cached.rows;
  const existing = repoMinersInFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const r = await fetch(`${REPO_EVALS_URL_BASE}/${encodeURIComponent(fullName)}/miners`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) throw new Error(`upstream repo miners ${fullName} ${r.status}`);
    const raw = (await r.json()) as unknown;
    const rows = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === 'object' && Array.isArray((raw as { miners?: unknown }).miners))
        ? ((raw as { miners: unknown[] }).miners)
        : [];
    const typedRows = rows
      .filter((row): row is UpstreamRepoMiner => Boolean(row) && typeof row === 'object')
      .filter((row) => {
        const rowRepo = repoNameFromRow(row);
        return !rowRepo || rowRepo === key;
      });
    repoMinersCache.set(key, { fetched_at: Date.now(), rows: typedRows });
    return typedRows;
  })().finally(() => {
    repoMinersInFlight.delete(key);
  });

  repoMinersInFlight.set(key, promise);
  return promise;
}

function stringValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function repoNameFromRow(row: UpstreamRepoMiner): string {
  return stringValue(row.repositoryFullName ?? row.repository_full_name).toLowerCase();
}

function repoScopedCredibility(row: UpstreamRepoMiner): number {
  return num(row.credibility ?? row.repoCredibility ?? row.repo_credibility ?? row.prCredibility ?? row.pr_credibility);
}

function meaningfulRepoMiner(row: {
  isEligible: boolean;
  score: number;
  baseScore: number;
  collateralScore: number;
  prCount: number;
  openPrCount: number;
  closedPrCount: number;
  totalPrCount: number;
}): boolean {
  return (
    row.isEligible ||
    row.score > 0 ||
    row.baseScore > 0 ||
    row.collateralScore > 0 ||
    row.prCount > 0 ||
    row.openPrCount > 0 ||
    row.closedPrCount > 0 ||
    row.totalPrCount > 0
  );
}

export async function GET(_req: Request, ctx: { params: Promise<{ owner: string; name: string }> }) {
  const params = await ctx.params;
  const fullName = `${params.owner}/${params.name}`;
  const fullNameKey = fullName.toLowerCase();
  try {
    const [shared, repoMinerRows] = await Promise.all([getShared(), fetchRepoMiners(fullName)]);
    const issueDiscoveryEnabled = (shared.issueDiscoveryShareByRepo.get(fullNameKey) ?? 0) > 0;
    const minersByGithubId = new Map<string, UpstreamMiner>();
    const minersByLogin = new Map<string, UpstreamMiner>();
    for (const m of shared.miners) {
      if (m.githubId) minersByGithubId.set(m.githubId, m);
      minersByLogin.set(m.githubUsername.toLowerCase(), m);
    }

    // OSS Contributions: per-repo validator rows. This endpoint already
    // includes the repo-scoped score and eligibility gate, so do not rebuild
    // the panel from global PR data or global miner score.
    const ossContributions = repoMinerRows
      .map((r) => {
        const githubId = stringValue(r.githubId ?? r.github_id);
        const username = r.githubUsername ?? r.github_username ?? '';
        const m = githubId ? minersByGithubId.get(githubId) : minersByLogin.get(username.toLowerCase());
        const rawUid = r.uid ?? m?.uid;
        const uidNum =
          typeof rawUid === 'number'
            ? rawUid
            : typeof rawUid === 'string'
              ? Number.parseInt(rawUid, 10)
              : NaN;
        const score = num(r.totalScore ?? r.total_score);
        const baseScore = num(r.baseTotalScore ?? r.base_total_score);
        const collateralScore = num(r.totalCollateralScore ?? r.total_collateral_score);
        const prCount = num(r.totalMergedPrs ?? r.total_merged_prs);
        const openPrCount = num(r.totalOpenPrs ?? r.total_open_prs);
        const closedPrCount = num(r.totalClosedPrs ?? r.total_closed_prs);
        const totalPrCount = num(r.totalPrs ?? r.total_prs);
        const isEligible = (r.isEligible ?? r.is_eligible) === true;
        return {
          githubId,
          githubUsername: username || m?.githubUsername || githubId,
          prCount,
          score: Number(score.toFixed(2)),
          baseScore: Number(baseScore.toFixed(2)),
          collateralScore: Number(collateralScore.toFixed(2)),
          openPrCount,
          closedPrCount,
          totalPrCount,
          credibility: repoScopedCredibility(r),
          ossRank: githubId ? shared.ossRankByGithubId.get(githubId) ?? null : null,
          globalScore: m ? Number(num(m.totalScore).toFixed(2)) : null,
          uid: Number.isFinite(uidNum) ? uidNum : null,
          avatarUrl: `https://github.com/${encodeURIComponent(username || m?.githubUsername || githubId)}.png?size=48`,
          isEligible,
          failedReason: r.failedReason ?? r.failed_reason ?? null,
          alphaPerDay: num(r.alphaPerDay ?? r.alpha_per_day),
          taoPerDay: num(r.taoPerDay ?? r.tao_per_day),
          usdPerDay: num(r.usdPerDay ?? r.usd_per_day),
        };
      })
      .filter(meaningfulRepoMiner)
      .sort((a, b) => {
        if ((a.isEligible ? 1 : 0) !== (b.isEligible ? 1 : 0)) return a.isEligible ? -1 : 1;
        return b.score - a.score || b.baseScore - a.baseScore || b.collateralScore - a.collateralScore || b.prCount - a.prCount;
      });

    // Issue Discoveries: repo-specific candidates only. Gittensor scores a
    // subset of solved issues: same-author issue/PR pairs and sibling issues
    // on the same solving PR are credibility-only. The hub does not have the
    // validator's per-issue earned score, so expose candidates + solved counts
    // instead of a fake score.
    backfillPrIssueLinksIfNeeded(fullName);
    const IS_MAINTAINER = `UPPER(COALESCE(i.author_association,'')) IN ('OWNER','MEMBER','COLLABORATOR')`;
    const HAS_MERGED_PR =
      `EXISTS (SELECT 1 FROM pr_issue_links l
               JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
               WHERE l.repo_full_name = i.repo_full_name AND l.issue_number = i.number AND p.merged = 1)`;
    const HAS_SAME_AUTHOR_MERGED_PR =
      `EXISTS (SELECT 1 FROM pr_issue_links l
               JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
               WHERE l.repo_full_name = i.repo_full_name
                 AND l.issue_number = i.number
                 AND p.merged = 1
                 AND LOWER(COALESCE(p.author_login,'')) = LOWER(COALESCE(i.author_login,'')))`;
    const IS_SCORE_CANDIDATE =
      `EXISTS (SELECT 1 FROM pr_issue_links l
               JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
               WHERE l.repo_full_name = i.repo_full_name
                 AND l.issue_number = i.number
                 AND p.merged = 1
                 AND LOWER(COALESCE(p.author_login,'')) <> LOWER(COALESCE(i.author_login,''))
                 AND NOT EXISTS (
                   SELECT 1 FROM pr_issue_links l2
                   JOIN issues i2 ON i2.repo_full_name = l2.repo_full_name AND i2.number = l2.issue_number
                   WHERE l2.repo_full_name = l.repo_full_name
                     AND l2.pr_number = l.pr_number
                     AND (
                       COALESCE(i2.created_at, '9999-12-31T23:59:59Z') < COALESCE(i.created_at, '9999-12-31T23:59:59Z')
                       OR (COALESCE(i2.created_at, '9999-12-31T23:59:59Z') = COALESCE(i.created_at, '9999-12-31T23:59:59Z') AND i2.number < i.number)
                     )
                 ))`;
    const issueRows = getReadDb()
      .prepare(
        `SELECT i.author_login,
                SUM(CASE WHEN i.state = 'closed' THEN 1 ELSE 0 END) AS issueCount,
                SUM(CASE WHEN i.state = 'closed' AND ${IS_MAINTAINER} THEN 1 ELSE 0 END) AS maintainerIssueCount,
                SUM(CASE WHEN i.state = 'closed' AND UPPER(COALESCE(i.author_association,'')) = 'OWNER' THEN 1 ELSE 0 END) AS ownerIssueCount,
                SUM(CASE WHEN i.state = 'closed'
                          AND UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                          AND ${HAS_MERGED_PR}
                    THEN 1 ELSE 0 END) AS completedIssueCount,
                SUM(CASE WHEN i.state = 'closed'
                          AND NOT (UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED' AND ${HAS_MERGED_PR})
                    THEN 1 ELSE 0 END) AS otherClosedIssueCount,
                SUM(CASE WHEN i.state = 'closed'
                          AND UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                          AND ${HAS_MERGED_PR}
                    THEN 1 ELSE 0 END) AS solvedIssueCount,
                SUM(CASE WHEN i.state = 'closed'
                          AND UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                          AND ${HAS_SAME_AUTHOR_MERGED_PR}
                    THEN 1 ELSE 0 END) AS sameAuthorSolvedCount,
                SUM(CASE WHEN i.state = 'closed'
                          AND UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                          AND NOT (${IS_MAINTAINER})
                          AND ${IS_SCORE_CANDIDATE}
                    THEN 1 ELSE 0 END) AS candidateIssueCount
         FROM issues i
         WHERE LOWER(i.repo_full_name) = LOWER(?) AND i.author_login IS NOT NULL
         GROUP BY LOWER(i.author_login)
         HAVING issueCount > 0`,
      )
      .all(fullName) as Array<{
        author_login: string;
        issueCount: number;
        maintainerIssueCount: number;
        ownerIssueCount: number;
        completedIssueCount: number;
        otherClosedIssueCount: number;
        solvedIssueCount: number;
        sameAuthorSolvedCount: number;
        candidateIssueCount: number;
      }>;

    const issueDiscoveries = issueRows
      .map((row) => {
        const m = minersByLogin.get(row.author_login.toLowerCase());
        if (!m) return null;
        const candidateIssueCount = issueDiscoveryEnabled ? row.candidateIssueCount : 0;
        return {
          githubId: m.githubId ?? '',
          githubUsername: m.githubUsername,
          prCount: candidateIssueCount,
          score: row.issueCount,
          issueCount: row.issueCount,
          completedIssueCount: row.completedIssueCount,
          otherClosedIssueCount: row.otherClosedIssueCount,
          solvedIssueCount: row.solvedIssueCount,
          candidateIssueCount,
          reason: issueDiscoveryEnabled ? issueDiscoveryReason({ ...row, candidateIssueCount, issueDiscoveryEnabled }) : null,
          ossRank: null,
          avatarUrl: `https://github.com/${m.githubUsername}.png?size=48`,
        };
      })
      .filter((row): row is {
        githubId: string;
        githubUsername: string;
        prCount: number;
        score: number;
        issueCount: number;
        completedIssueCount: number;
        otherClosedIssueCount: number;
        solvedIssueCount: number;
        candidateIssueCount: number;
        reason: string | null;
        ossRank: null;
        avatarUrl: string;
      } => Boolean(row))
      .sort((a, b) => b.issueCount - a.issueCount || b.candidateIssueCount - a.candidateIssueCount || b.solvedIssueCount - a.solvedIssueCount)
      .slice(0, TOP_ISSUE_DISCOVERY_LIMIT);

    return NextResponse.json({
      fullName,
      issueDiscoveryEnabled,
      ossContributions,
      issueDiscoveries,
      fetched_at: shared.fetched_at,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
