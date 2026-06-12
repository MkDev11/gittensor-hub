/* Miner derivation layer.
 *
 * The `/api/miners/activity` feed returns raw `Miner[]` rows (camelCase from
 * our DTO, but with snake_case fallbacks mirroring the upstream scorer). This
 * module turns each raw miner into a single `MinerView` — the shape every
 * surface on the page renders (cards, list rows, drawer, podium, treemap,
 * market bar, compare modal, palette). Keeping all the parsing + scoring math
 * here means the components stay presentational and the wire-quirks live in
 * exactly one place. */

import type { Miner, MinerRepoEvaluation } from '@/types/entities';

// ─── Public enums ─────────────────────────────────────────────────────────────

export type SortKey = 'activity' | 'earnings' | 'score' | 'repos' | 'name';
export type SortDir = 'asc' | 'desc';
export type ViewMode = 'card' | 'list';
/** Which headline visualization is showing. The page lets users flip between
 *  all four so they can pick whichever reads best for their question. */
export type HeadlineMode = 'podium' | 'treemap' | 'market' | 'metrics';

// ─── Wire shape ───────────────────────────────────────────────────────────────

export type MinerWire = Miner & {
  github_username?: string;
  github_id?: string | number;
  isMaintainer?: boolean;
  maintainerRepos?: string[];
  maintainerCut?: number;
  maintainerTaoShare?: number;
  maintainerRepoTaoShares?: Record<string, number>;
  failed_reason?: string | null;
  total_score?: string | number;
  issue_discovery_score?: string | number;
  issue_credibility?: string | number;
  total_prs?: string | number;
  total_merged_prs?: string | number;
  total_open_prs?: string | number;
  total_closed_prs?: string | number;
  total_solved_issues?: string | number;
  total_valid_solved_issues?: string | number;
  total_open_issues?: string | number;
  total_closed_issues?: string | number;
  usd_per_day?: string | number;
  tao_per_day?: string | number;
  alpha_per_day?: string | number;
  unique_repos_count?: string | number;
  // Scoring internals + code volume — surfaced in the miner modal. camelCase from
  // the activity DTO (not all are on the Miner type), snake_case from the raw scorer.
  totalCollateralScore?: string | number;
  total_collateral_score?: string | number;
  totalTokenScore?: string | number;
  total_token_score?: string | number;
  totalNodesScored?: string | number;
  total_nodes_scored?: string | number;
  totalStructuralCount?: string | number;
  total_structural_count?: string | number;
  totalStructuralScore?: string | number;
  total_structural_score?: string | number;
  totalLeafCount?: string | number;
  total_leaf_count?: string | number;
  totalLeafScore?: string | number;
  total_leaf_score?: string | number;
  base_total_score?: string | number;
  total_additions?: string | number;
  total_deletions?: string | number;
};

// ─── Derived shapes ───────────────────────────────────────────────────────────

export interface RepoSignal {
  repo: string;
  prScore: number;
  issueScore: number;
  /** Issue-solving reward score (tokens for solved issues). Distinct from
   * issueScore (issue discovery) and NOT gated by issueDiscoveryShare — e.g.
   * matthewevans earns on phase-rs/phase via solving, with share = 0. */
  issueTokenScore: number;
  baseScore: number;
  collateralScore: number;
  prs: number;
  mergedPrs: number;
  openPrs: number;
  closedPrs: number;
  issues: number;
  solvedIssues: number;
  /** Solved issues whose solving PR cleared the token-score validity bar — the subset
   * the issue-discovery eligibility gate actually counts. */
  validSolvedIssues: number;
  openIssues: number;
  closedIssues: number;
  prCred: number;
  issueCred: number;
  /** This repo's OWN eligibility floors (validator config, defaulted when the repo
   * uses subnet defaults): min PR credibility (default 0.8), min issue-discovery
   * credibility (default 0.7), and the min merged-PR / solved-issue counts
   * (default 3 / 3). Per-repo — a repo can lower the bar (e.g. taopedia-articles
   * min cred 0.5) or drop it entirely (oc-1 → 0), so badges and the "working
   * toward earning" gate read against the repo's own threshold, not a global one. */
  minPrCred: number;
  minIssueCred: number;
  minMergedPrs: number;
  minSolvedIssues: number;
  prEligible: boolean;
  issueEligible: boolean;
  /** Fraction of this repo's emission allocated to issue discovery (0..1). When
   * 0, issue work here earns nothing — all emission goes to PRs. */
  issueDiscoveryShare: number;
  /** Repo's share of the OSS emission pool (0..1) — how big this repo's reward
   * slice is. Surfaced so the card can explain why one repo pays more than
   * another despite similar scores. */
  emissionShare: number;
  /** This contributor's PR / issue-discovery emission from THIS repo, each as a
   * fraction of the subnet TAO (server-computed via the repositories-page model:
   * repo pool × the miner's score-share among all eligible contributors). The
   * card multiplies by subnetTAO for the per-repo TAO/day. */
  prTaoShare: number;
  issueTaoShare: number;
  /** Maintainer-cut emission from this repo as a fraction of subnet TAO (0 unless
   * the miner maintains it). */
  maintainerTaoShare: number;
  taoPerDay: number;
  usdPerDay: number;
}

export interface MinerView {
  miner: Miner;
  key: string;
  login: string;
  githubId: string;
  uid: number | null;
  /** On-chain hotkey (ss58) — for chain explorer links in the detail modal. */
  hotkey: string;
  avatarUrl: string;
  rows: RepoSignal[];
  topRepos: RepoSignal[];
  /** Count of repos the miner actually earns from (PR pool, issue discovery, or
   * maintainer cut) — may exceed the few shown in topRepos, so the card can note
   * "+N more". */
  earningRepoCount: number;
  /** Repos the miner is contributing to but not yet earning from, most-lucrative
   * first (by emission share) — the "almost earning" growth list (capped). */
  blockedRepos: RepoSignal[];
  /** Total count of not-yet-earning repos (may exceed blockedRepos) so the card
   * can note "+N more". */
  blockedRepoCount: number;
  totalScore: number;
  issueScore: number;
  usdPerDay: number;
  taoPerDay: number;
  totalPrs: number;
  totalIssues: number;
  /** PR outcome breakdown — open / merged / closed. Cumulative (all-time) from
   * the scorer feed: the per-miner data exposes only `total*` counts, with no
   * 30-day window (only repo-level data carries a 30d window, and it can't be
   * attributed per miner). Summed across the miner's repo rows. */
  prOpen: number;
  prMerged: number;
  prClosed: number;
  /** Issue breakdown — open / closed (no merged solving PR) / completed (solved
   * by a MERGED PR). Cumulative, same caveat as the PR breakdown. */
  issueOpen: number;
  issueClosed: number;
  issueCompleted: number;
  /** Issues solved by a MERGED PR that also cleared the validity bar (token-score
   * threshold) — the subset of completed issues that actually count toward issue
   * eligibility. */
  validSolvedIssues: number;
  uniqueRepos: number;
  /** Scoring internals (gittensor scores the AST nodes of merged PRs): the raw
   * base score, collateral (pending score from open PRs), the token score, and the
   * structural / leaf node counts + scores. Surfaced in the modal's scoring panel. */
  baseScore: number;
  collateralScore: number;
  tokenScore: number;
  nodesScored: number;
  structuralCount: number;
  structuralScore: number;
  leafCount: number;
  leafScore: number;
  /** Cumulative lines added / removed across the miner's merged work. */
  additions: number;
  deletions: number;
  prCred: number;
  issueCred: number;
  prEligible: boolean;
  issueEligible: boolean;
  /** Whether the miner actually EARNS from each stream — eligibility AND'd with
   * the repo's emission share. A miner only earns from issue discovery on repos
   * whose issueDiscoveryShare > 0, and from PRs on repos whose share < 1. So a
   * miner issue-eligible only on share-0 repos (e.g. bitloi) is PR-only. */
  prEarning: boolean;
  issueEarning: boolean;
  /** Whether the miner is a maintainer of any tracked repo — they earn the
   * repo's maintainer-cut, a reward stream distinct from PRs / issue discovery
   * (e.g. jjmata, who maintains we-promise/sure but has no scored PRs). */
  isMaintainer: boolean;
  maintainerRepos: string[];
  /** Maintainer-cut fraction (0..1) of the repo they maintain — e.g. 0.3 for
   * jjmata on we-promise/sure. Max across their maintained repos. */
  maintainerCut: number;
  /** Maintainer-cut emission as a fraction of the subnet TAO — the card turns
   * this into TAO (× subnetTAO) to size the maintainer segment of the split bar. */
  maintainerTaoShare: number;
  /** This miner's total PR / issue-discovery emission, each as a fraction of the
   * subnet TAO (summed over their repos from the repositories-page model). The
   * card multiplies by subnetTAO to size the PR / issue split-bar segments. */
  prTaoShare: number;
  issueTaoShare: number;
  failedReason: string | null;
  activity: number;
}

// ─── Option tables (shared by toolbar + headline switcher) ─────────────────────

export const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'activity', label: 'Activity' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'score', label: 'Score' },
  { key: 'repos', label: 'Repo count' },
  { key: 'name', label: 'Name' },
];

export const HEADLINE_OPTIONS: Array<{ key: HeadlineMode; label: string; caption: string }> = [
  { key: 'podium', label: 'Podium', caption: 'top earners ranked' },
  { key: 'treemap', label: 'Treemap', caption: 'sized by output' },
  { key: 'market', label: 'Market', caption: 'emission + spread' },
  { key: 'metrics', label: 'Metrics', caption: 'headline numbers' },
];

export const EMPTY_MINERS: Miner[] = [];
const EMPTY_REPO_SIGNALS: RepoSignal[] = [];

// ─── Number coercion ──────────────────────────────────────────────────────────

export function num(value: unknown): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Coerce a 0..1 ratio. Upstream sometimes sends 0..100 percentages instead,
 *  so anything > 1 is treated as a percentage and scaled down. */
export function ratio(value: unknown): number {
  const n = num(value);
  if (n <= 0) return 0;
  return n > 1 ? Math.min(n / 100, 1) : Math.min(n, 1);
}

export function pct(value: unknown): string {
  return `${Math.round(ratio(value) * 100)}%`;
}

export function score(value: unknown, digits = 1): string {
  const n = num(value);
  if (!n) return '-';
  return n >= 1000 ? n.toFixed(0) : n.toFixed(digits);
}

/** "% of pool" share text — 2 decimals under 1%, else 1 — shared by the treemap
 * inspector and the miner cards so the figure reads identically on both. */
export function shareText(value: number, total: number): string {
  if (total <= 0) return '0%';
  const p = (value / total) * 100;
  return `${p.toFixed(p < 1 ? 2 : 1)}%`;
}

function normalizedRepoName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const repo = value.trim();
  return repo.includes('/') ? repo : null;
}

// ─── Wire accessors ───────────────────────────────────────────────────────────

function minerWire(miner: Miner): MinerWire {
  return miner as MinerWire;
}

export function minerLogin(miner: Miner): string {
  const wire = minerWire(miner);
  return (
    miner.githubUsername ||
    wire.github_username ||
    miner.githubId ||
    String(wire.github_id ?? '') ||
    `uid-${miner.uid ?? 'unknown'}`
  );
}

export function minerGithubId(miner: Miner): string {
  const wire = minerWire(miner);
  return String(miner.githubId ?? wire.github_id ?? '');
}

export function minerTrackKey(view: MinerView): string {
  return view.githubId || view.login || String(view.uid ?? '');
}

// ─── Repo signal derivation ───────────────────────────────────────────────────

function repoSignalBase(row: MinerRepoEvaluation, fallbackRepo: string | null): RepoSignal | null {
  const repo = normalizedRepoName(row.repositoryFullName ?? row.repository_full_name ?? fallbackRepo);
  if (!repo) return null;
  const mergedPrs = num(row.totalMergedPrs ?? row.total_merged_prs);
  const openPrs = num(row.totalOpenPrs ?? row.total_open_prs);
  const closedPrs = num(row.totalClosedPrs ?? row.total_closed_prs);
  const prs = num(row.totalPrs ?? row.total_prs) || mergedPrs + openPrs + closedPrs;
  const solvedIssues = num(row.totalSolvedIssues ?? row.total_solved_issues);
  const openIssues = num(row.totalOpenIssues ?? row.total_open_issues);
  const closedIssues = num(row.totalClosedIssues ?? row.total_closed_issues);
  const validSolvedIssues = num(row.totalValidSolvedIssues ?? row.total_valid_solved_issues);
  const issues = Math.max(solvedIssues + openIssues, closedIssues + openIssues, validSolvedIssues);
  // Per-repo eligibility floors stamped by the activity API. null/absent → the
  // subnet default; a present value (incl. a configured 0 = "no gate") is honored.
  const elig = row as { minPrCred?: unknown; minIssueCred?: unknown; minMergedPrs?: unknown; minSolvedIssues?: unknown };
  const pickRatio = (v: unknown, dflt: number) => (v == null ? dflt : ratio(v));
  const pickCount = (v: unknown, dflt: number) => (v == null ? dflt : num(v));
  return {
    repo,
    prScore: num(row.totalScore ?? row.total_score),
    issueScore: num(row.issueDiscoveryScore ?? row.issue_discovery_score),
    issueTokenScore: num(row.issueTokenScore ?? row.issue_token_score),
    baseScore: num(row.baseTotalScore ?? row.base_total_score),
    collateralScore: num(row.totalCollateralScore ?? row.total_collateral_score),
    prs,
    mergedPrs,
    openPrs,
    closedPrs,
    issues,
    solvedIssues,
    validSolvedIssues,
    openIssues,
    closedIssues,
    prCred: ratio(row.credibility),
    issueCred: ratio(row.issueCredibility ?? row.issue_credibility),
    minPrCred: pickRatio(elig.minPrCred, MIN_ELIGIBLE_CREDIBILITY),
    minIssueCred: pickRatio(elig.minIssueCred, MIN_ELIGIBLE_ISSUE_CREDIBILITY),
    minMergedPrs: pickCount(elig.minMergedPrs, MIN_MERGED_PRS),
    minSolvedIssues: pickCount(elig.minSolvedIssues, MIN_SOLVED_ISSUES),
    prEligible: (row.isEligible ?? row.is_eligible) === true,
    issueEligible: (row.isIssueEligible ?? row.is_issue_eligible) === true,
    issueDiscoveryShare: num((row as { issueDiscoveryShare?: unknown }).issueDiscoveryShare),
    emissionShare: num((row as { emissionShare?: unknown }).emissionShare),
    prTaoShare: num((row as { prTaoShare?: unknown }).prTaoShare),
    issueTaoShare: num((row as { issueTaoShare?: unknown }).issueTaoShare),
    maintainerTaoShare: 0, // stamped per-repo in minerView from the maintainer map
    taoPerDay: num(row.taoPerDay ?? row.tao_per_day),
    usdPerDay: num(row.usdPerDay ?? row.usd_per_day),
  };
}

function repoStrength(row: RepoSignal): number {
  return (
    row.prScore * 1.2 +
    row.issueScore * 1.35 +
    row.baseScore * 0.25 +
    row.collateralScore * 0.18 +
    row.prs * 2 +
    row.issues * 2.4 +
    row.taoPerDay * 120
  );
}

function hasRepoSignal(row: RepoSignal): boolean {
  return (
    row.prEligible ||
    row.issueEligible ||
    row.prScore > 0 ||
    row.issueScore > 0 ||
    row.issueTokenScore > 0 ||
    row.baseScore > 0 ||
    row.collateralScore > 0 ||
    row.prs > 0 ||
    row.issues > 0
    // usdPerDay is deliberately NOT a signal: the upstream attaches a miner's
    // network-wide $/day onto EVERY repo row they're listed in, so counting it
    // would inflate "repos" to all tracked repos. A repo counts only when there
    // is real per-repo activity (eligibility, score, PRs, or issues).
  );
}

function repoSignalsForMiner(miner: Miner): RepoSignal[] {
  const raw = miner.repoEvaluations ?? miner.repo_evaluations;
  if (!raw) return EMPTY_REPO_SIGNALS;

  const entries: Array<[string | null, MinerRepoEvaluation]> = Array.isArray(raw)
    ? raw.map((row) => [null, row])
    : Object.entries(raw);
  return entries
    .map(([fallbackRepo, row]) => repoSignalBase(row, fallbackRepo))
    .filter((row): row is RepoSignal => Boolean(row))
    .filter(hasRepoSignal)
    .sort((a, b) => repoStrength(b) - repoStrength(a) || a.repo.localeCompare(b.repo));
}

// ─── Miner view ───────────────────────────────────────────────────────────────

/** A zero-activity RepoSignal for a repo the miner maintains but hasn't
 * contributed to — lets it still appear in "top repos" (they earn its cut). */
function maintainerOnlyRepo(repo: string): RepoSignal {
  return {
    repo,
    prScore: 0,
    issueScore: 0,
    issueTokenScore: 0,
    baseScore: 0,
    collateralScore: 0,
    prs: 0,
    mergedPrs: 0,
    openPrs: 0,
    closedPrs: 0,
    issues: 0,
    solvedIssues: 0,
    validSolvedIssues: 0,
    openIssues: 0,
    closedIssues: 0,
    prCred: 0,
    issueCred: 0,
    minPrCred: MIN_ELIGIBLE_CREDIBILITY,
    minIssueCred: MIN_ELIGIBLE_ISSUE_CREDIBILITY,
    minMergedPrs: MIN_MERGED_PRS,
    minSolvedIssues: MIN_SOLVED_ISSUES,
    prEligible: false,
    issueEligible: false,
    issueDiscoveryShare: 0,
    emissionShare: 0,
    prTaoShare: 0,
    issueTaoShare: 0,
    maintainerTaoShare: 0, // stamped in minerView from the maintainer map
    taoPerDay: 0,
    usdPerDay: 0,
  };
}

// ─── Reward-stream predicates ─────────────────────────────────────────────────
// The two contributor reward streams, gated on per-repo eligibility (a score
// with no eligibility pays $0). Shared by minerView AND the treemap/chip colors
// so the classification can never drift between them.

/** PR / contributor pool — merged PRs or issue *solving* (issueTokenScore), paid
 *  where the miner is PR-eligible and PRs pay (issueDiscoveryShare < 1). */
export function repoEarnsPr(row: RepoSignal): boolean {
  return row.prEligible && (row.prScore > 0 || row.issueTokenScore > 0) && row.issueDiscoveryShare < 1;
}

/** Issue discovery — a scored discovery on a repo whose issue-discovery share
 *  actually pays (> 0), with the miner issue-eligible. */
export function repoEarnsIssueDiscovery(row: RepoSignal): boolean {
  return row.issueEligible && row.issueScore > 0 && row.issueDiscoveryShare > 0;
}

/** Sum of a repo's contributor stream shares (PR + issue-discovery + maintainer)
 *  as a fraction of subnet TAO — repoTaoOf without the subnetTAO multiplier. Lets
 *  callers order repos by the miner's per-repo emission without depending on the
 *  live subnet TAO (a constant multiplier) having loaded yet. */
export function repoStreamShare(row: RepoSignal): number {
  return row.prTaoShare + row.issueTaoShare + row.maintainerTaoShare;
}

/** Per-repo TAO/day a miner earns from one repo — subnetTAO × the sum of the
 *  server-stamped PR, issue-discovery, and maintainer-cut shares. Matches the
 *  repositories page (e.g. MkDev11 ≈ 0.039 on gittensory). */
export function repoTaoOf(row: RepoSignal, subnetTao: number): number {
  return subnetTao * repoStreamShare(row);
}

// SN74 eligibility thresholds — the validator's DEFAULT floors. Each repo can
// override any of these via config.eligibility (e.g. taopedia-articles drops min
// cred to 0.5, oc-1 to 0); the activity API stamps the per-repo override onto each
// row, and repoSignalBase resolves override-or-default into the RepoSignal's
// min* fields. Use those per-row fields for gating; these are only the fallback.
// credibility = merged ÷ (merged + closed).
const MIN_MERGED_PRS = 3;
const MIN_SOLVED_ISSUES = 3;
/** Default min PR credibility (PR rewards). */
export const MIN_ELIGIBLE_CREDIBILITY = 0.8;
/** Default min issue-discovery credibility — matches gittensor MIN_ISSUE_CREDIBILITY
 * (0.80, same as PRs). Only a fallback; the feed's per-repo min_issue_credibility wins. */
const MIN_ELIGIBLE_ISSUE_CREDIBILITY = 0.8;

/** When each repo was registered on gittensor — i.e. added to the validator's
 * master_repositories.json. A repo's GitHub history long predates this (repos exist
 * for years before joining SN74), so contributions made BEFORE registration are not
 * SN74 work and must not inflate a miner's "working age". Dates are the config commit
 * that first introduced the repo key (a faithful proxy for on-chain registration).
 * Keep in sync when repos are added to master_repositories.json. */
export const REPO_REGISTERED_AT: Record<string, string> = {
  'infiniflow/ragflow': '2025-10-29',
  'entrius/gittensor': '2025-11-04',
  'we-promise/sure': '2026-01-14',
  'entrius/gittensor-ui': '2026-02-27',
  'entrius/allways': '2026-03-25',
  'entrius/das-github-mirror': '2026-05-01',
  'entrius/oc-1': '2026-05-12',
  'geniepod/genie-claw': '2026-05-15',
  'mkdev11/gittensor-hub': '2026-05-15',
  'seroperson/jvm-live-reload': '2026-05-15',
  'jsonbored/awesome-claude': '2026-05-19',
  'touchpilot/touchpilot': '2026-05-19',
  'vouchdev/vouch': '2026-05-22',
  'jsonbored/gittensory': '2026-05-28',
  'phase-rs/phase': '2026-05-28',
  'cogniax/tao-pulse-app': '2026-05-29',
  'e35ventura/taopedia': '2026-05-29',
  'e35ventura/taopedia-articles': '2026-05-29',
};

const REPO_REGISTERED_MS: Record<string, number> = Object.fromEntries(
  Object.entries(REPO_REGISTERED_AT).map(([k, v]) => [k, Date.parse(`${v}T00:00:00Z`)]),
);
/** Newest known registration — the fallback for a repo absent from the map (i.e. one
 * registered after this map was last updated, hence at least this recent). Using the
 * latest, not the earliest, keeps an un-mapped repo from over-stating working age. */
const LATEST_REPO_REGISTERED_MS = Math.max(...Object.values(REPO_REGISTERED_MS));

/** Epoch ms at which `repo` (owner/name) became an SN74 repo. Falls back to the newest
 * known registration for repos not yet in the map. */
export function repoRegisteredMs(repo: string): number {
  return REPO_REGISTERED_MS[repo.toLowerCase()] ?? LATEST_REPO_REGISTERED_MS;
}

/** A repo the miner is actively contributing to but NOT yet earning from — work
 *  is happening (merged/open PRs, a PR score, or solved/scored issues) but the
 *  repo hasn't cleared eligibility (and it isn't a maintained / earning repo).
 *  These are the "almost earning" growth opportunities the card surfaces. */
export function isBlockedContribution(row: RepoSignal, maintained: boolean): boolean {
  if (maintained || repoEarnsPr(row) || repoEarnsIssueDiscovery(row)) return false;
  const prWork = row.issueDiscoveryShare < 1 && (row.mergedPrs > 0 || row.openPrs > 0 || row.prScore > 0);
  const issueWork = row.issueDiscoveryShare > 0 && (row.issueScore > 0 || row.solvedIssues > 0);
  return prWork || issueWork;
}

/** A miner's progress toward clearing the eligibility gate on a contributing-but-
 *  not-yet-earning repo: the binding gate as a short human reason PLUS how far
 *  along they are (0..1), so the "working toward earning" UI can show a progress
 *  bar, not just a static label. Derived from the same gates the validator applies
 *  (≥3 merged PRs / solved issues and ≥80% credibility). */
export interface BlockGate {
  /** Short human reason, e.g. "1/3 merged PRs" or "72% cred · need 80%". */
  text: string;
  /** Short COUNT requirement to show beside the outcome counts, e.g. "need 3".
   *  '' for credibility gates — the avatar's credibility ring conveys those — and
   *  when nothing applies. */
  need: string;
  /** Fraction of the way to clearing this specific gate (0..1). */
  progress: number;
  /** Which reward stream the binding gate is on — drives the bar's color and
   *  which outcome counts (PR merged/closed vs issue solved/closed) it shows. */
  stream: 'pr' | 'issue';
  /** Count threshold for the stream (merged PRs / solved issues). The progress bar
   *  fills toward max(target, good+closed), so 1 of 3 reads as a third full rather
   *  than complete, while higher volumes show the merged-vs-closed ratio. */
  target: number;
}

export function blockGate(row: RepoSignal): BlockGate {
  const frac = (have: number, need: number) => Math.max(0, Math.min(1, need > 0 ? have / need : 0));
  // Gate against THIS repo's own floors (validator config, defaulted) — not a
  // global 80%/3 — so the reason matches what the repo actually requires.
  const minMerged = row.minMergedPrs;
  const minSolved = row.minSolvedIssues;
  const prWork = row.issueDiscoveryShare < 1 && (row.mergedPrs > 0 || row.openPrs > 0 || row.prScore > 0);
  if (prWork) {
    if (row.mergedPrs < minMerged)
      return { text: `${row.mergedPrs}/${minMerged} merged PRs`, need: `need ${minMerged}`, progress: frac(row.mergedPrs, minMerged), stream: 'pr', target: minMerged };
    if (row.prCred < row.minPrCred)
      return { text: `${Math.round(row.prCred * 100)}% cred · need ${Math.round(row.minPrCred * 100)}%`, need: '', progress: frac(row.prCred, row.minPrCred), stream: 'pr', target: minMerged };
  }
  if (row.issueDiscoveryShare > 0 && (row.issueScore > 0 || row.solvedIssues > 0)) {
    if (row.solvedIssues < minSolved)
      return { text: `${row.solvedIssues}/${minSolved} solved issues`, need: `need ${minSolved}`, progress: frac(row.solvedIssues, minSolved), stream: 'issue', target: minSolved };
    if (row.issueCred < row.minIssueCred)
      return { text: `${Math.round(row.issueCred * 100)}% issue cred · need ${Math.round(row.minIssueCred * 100)}%`, need: '', progress: frac(row.issueCred, row.minIssueCred), stream: 'issue', target: minSolved };
  }
  return { text: 'not yet eligible', need: '', progress: 0, stream: prWork ? 'pr' : 'issue', target: prWork ? minMerged : minSolved };
}

/** Why a contributing repo isn't earning yet, as a short human label (see blockGate). */
export function blockReason(row: RepoSignal): string {
  return blockGate(row).text;
}

export function minerView(
  miner: Miner,
  subnetTao = 0,
  usdPerTao = 0,
  /** This miner's ACTUAL on-chain daily TAO (alpha_per_day × price for its uid,
   *  from the emission feed) — the exact TaoMarketCap figure. When provided it's
   *  the authoritative headline emission, and the score-share model is rescaled to
   *  it so the per-repo / split-bar breakdown reconciles. Omitted (or undefined)
   *  for a uid the feed doesn't cover → fall back to the model. */
  actualTaoPerDay?: number | null,
): MinerView {
  const wire = minerWire(miner);
  const rows = repoSignalsForMiner(miner);
  const rowPrs = rows.reduce((sum, row) => sum + row.prs, 0);
  const rowIssues = rows.reduce((sum, row) => sum + row.issues, 0);
  const rowUsd = rows.reduce((sum, row) => sum + row.usdPerDay, 0);
  const rowTao = rows.reduce((sum, row) => sum + row.taoPerDay, 0);
  const totalPrs =
    rowPrs ||
    num(miner.totalPrs ?? wire.total_prs) ||
    num(miner.totalMergedPrs ?? wire.total_merged_prs) +
      num(miner.totalOpenPrs ?? wire.total_open_prs) +
      num(miner.totalClosedPrs ?? wire.total_closed_prs);
  const totalIssues =
    rowIssues ||
    num(miner.totalSolvedIssues ?? wire.total_solved_issues) + num(miner.totalOpenIssues ?? wire.total_open_issues);
  // PR / issue outcome breakdowns. Per-repo counts are genuine per-repo figures
  // (see the totalPrs comment below), so sum them when rows exist; fall back to
  // the miner-level cumulative totals only for miners discovered solely via repo
  // rows that carry no per-repo counts.
  const sumRows = (pick: (r: RepoSignal) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
  const hasRows = rows.length > 0;
  const prMerged = hasRows ? sumRows((r) => r.mergedPrs) : num(miner.totalMergedPrs ?? wire.total_merged_prs);
  const prOpen = hasRows ? sumRows((r) => r.openPrs) : num(miner.totalOpenPrs ?? wire.total_open_prs);
  const prClosed = hasRows ? sumRows((r) => r.closedPrs) : num(miner.totalClosedPrs ?? wire.total_closed_prs);
  const issueOpen = hasRows ? sumRows((r) => r.openIssues) : num(miner.totalOpenIssues ?? wire.total_open_issues);
  const issueClosed = hasRows ? sumRows((r) => r.closedIssues) : num(miner.totalClosedIssues ?? wire.total_closed_issues);
  const issueCompleted = hasRows ? sumRows((r) => r.solvedIssues) : num(miner.totalSolvedIssues ?? wire.total_solved_issues);
  const login = minerLogin(miner);
  const githubId = minerGithubId(miner);
  const totalScore = num(miner.totalScore ?? wire.total_score);
  const issueScore = num(miner.issueDiscoveryScore ?? wire.issue_discovery_score);
  // Earnings are a MINER-level property — the upstream attaches each miner's
  // network-wide usd/tao-per-day onto every per-repo row, so summing the rows
  // (rowUsd/rowTao) multiplies a miner's emission by their repo count. Use the
  // top-level network value; fall back to the row sum only when it's absent
  // (e.g. miners discovered solely via repo rows). PR/issue counts ARE genuine
  // per-repo figures, so those keep summing above.
  const feedUsd = num(miner.usdPerDay ?? wire.usd_per_day) || rowUsd;
  // Upstream's network-wide TAO/day — kept only as a fallback for the accurate
  // model below (used until the live subnet TAO has loaded).
  const feedTaoPerDay = num(miner.taoPerDay ?? wire.tao_per_day) || rowTao;
  const uniqueRepos = rows.length || num(miner.uniqueReposCount ?? wire.unique_repos_count);
  // Scoring internals + code volume (miner-level, all-time) — for the modal's
  // scoring panel. baseScore/additions/deletions/validSolvedIssues are on the Miner
  // type; the rest come via the wire (camelCase from the DTO, snake_case fallback).
  const hotkey = typeof miner.hotkey === 'string' ? miner.hotkey : '';
  const baseScore = num(miner.baseTotalScore ?? wire.base_total_score);
  const collateralScore = num(wire.totalCollateralScore ?? wire.total_collateral_score);
  const tokenScore = num(wire.totalTokenScore ?? wire.total_token_score);
  const nodesScored = num(wire.totalNodesScored ?? wire.total_nodes_scored);
  const structuralCount = num(wire.totalStructuralCount ?? wire.total_structural_count);
  const structuralScore = num(wire.totalStructuralScore ?? wire.total_structural_score);
  const leafCount = num(wire.totalLeafCount ?? wire.total_leaf_count);
  const leafScore = num(wire.totalLeafScore ?? wire.total_leaf_score);
  const additions = num(miner.totalAdditions ?? wire.total_additions);
  const deletions = num(miner.totalDeletions ?? wire.total_deletions);
  const validSolvedIssues = num(miner.totalValidSolvedIssues ?? wire.total_valid_solved_issues);
  const prCred = ratio(miner.credibility);
  const issueCred = ratio(miner.issueCredibility ?? wire.issue_credibility);
  const prEligible = rows.some((row) => row.prEligible);
  const issueEligible = rows.some((row) => row.issueEligible);
  // Issue-discovery earning needs an actual discovery SCORE on a repo that pays
  // for it — not mere eligibility. A miner can be issue-eligible on a paying repo
  // (issueDiscoveryShare > 0) yet score zero there (earns nothing), while their
  // nonzero discovery score sits on a share-0 repo that pays it $0 — hence the
  // score AND share gate on the SAME row.
  // Issue DISCOVERY only — finding/reporting issues (issueScore, gated by
  // issueDiscoveryShare > 0). Solving issues is NOT discovery (see prEarning).
  const issueEarning = rows.some(repoEarnsIssueDiscovery);
  // PR / contributor pool — merged PRs OR issue *solving* (issueTokenScore). Both
  // pay from the repo's contributor pool, GATED BY PR eligibility (isEligible) and
  // only where PRs pay (share < 1). A pure issue-solver WITH prEligible (e.g.
  // pandadev66 on infiniflow/ragflow) reads as a PR contributor; an INELIGIBLE one
  // (ai-hpc — a 206 issue-token score on geniepod/genie-claw that pays $0) does
  // NOT, leaving it to its maintainer-cut stream alone.
  const prEarning = rows.some(repoEarnsPr);
  // Maintainer-cut stream — flagged server-side from the repo maintainer rosters.
  const isMaintainer = wire.isMaintainer === true;
  const maintainerRepos = Array.isArray(wire.maintainerRepos) ? wire.maintainerRepos : [];
  const maintainerCut = num(wire.maintainerCut);
  const maintainerTaoShare = num(wire.maintainerTaoShare);
  const maintainerRepoShares = wire.maintainerRepoTaoShares ?? {};
  const maintainerShareFor = (repo: string): number => {
    const target = repo.toLowerCase();
    for (const [key, value] of Object.entries(maintainerRepoShares)) {
      if (key.toLowerCase() === target) return num(value);
    }
    return 0;
  };
  // Per-stream emission shares (fractions of subnet TAO) — summed from the
  // server-stamped per-repo shares. Multiplying by subnetTAO sizes the PR / issue
  // split-bar segments and the headline emission total.
  const prTaoShare = rows.reduce((sum, row) => sum + row.prTaoShare, 0);
  const issueTaoShare = rows.reduce((sum, row) => sum + row.issueTaoShare, 0);
  // Daily TAO. The score-share MODEL (subnetTAO × summed PR + issue + maintainer
  // shares) distributes each repo's full contributor pool by score — it ignores
  // the slice that recycles unclaimed, so it runs a few % high. The ACTUAL on-chain
  // per-UID emission (alpha_per_day × price, passed in from the feed) is exactly
  // what TaoMarketCap shows, so it's the authoritative headline when available. We
  // keep the model for the per-repo / per-stream BREAKDOWN but rescale it onto the
  // actual total (taoScale) so the split bars and per-repo τ/day reconcile with the
  // headline. Falls back to the model, then the upstream feed, while the emission
  // (or this uid) is unavailable.
  const modelTaoPerDay = subnetTao > 0 ? subnetTao * (prTaoShare + issueTaoShare + maintainerTaoShare) : feedTaoPerDay;
  const hasActual = actualTaoPerDay != null && Number.isFinite(actualTaoPerDay) && actualTaoPerDay >= 0;
  const taoPerDay = hasActual ? (actualTaoPerDay as number) : modelTaoPerDay;
  // Per-miner factor mapping the model breakdown onto the actual total (1 = no-op).
  const taoScale = hasActual && modelTaoPerDay > 0 ? (actualTaoPerDay as number) / modelTaoPerDay : 1;
  // USD/day derived from the accurate TAO at the live TAO→USD rate, so $/day stays
  // consistent with the emission everywhere it's shown or sorted (the upstream's own
  // usd/day is the unreliable phantom value).
  const usdPerDay = usdPerTao > 0 ? taoPerDay * usdPerTao : feedUsd;
  // "Top repos" lists only repos the miner actually earns incentives from: a
  // PR-pool contribution — merged PRs or issue solving (token score) — where the
  // miner is PR-eligible and PRs pay (share < 1); a scored issue discovery where
  // issue-eligible and it pays (share > 0); or a repo they maintain (maintainer-
  // cut). A score without eligibility pays $0, so it's excluded — e.g. ai-hpc's
  // 206 issue-token score on geniepod/genie-claw (ineligible) is dropped, leaving
  // only the repo he maintains.
  const maintainerRepoSet = new Set(maintainerRepos.map((repo) => repo.toLowerCase()));
  const earningRepos = rows.filter(
    (row) => maintainerRepoSet.has(row.repo.toLowerCase()) || repoEarnsPr(row) || repoEarnsIssueDiscovery(row),
  );
  const isMaintained = (row: RepoSignal) => maintainerRepoSet.has(row.repo.toLowerCase());
  const shownRepos = new Set(earningRepos.map((row) => row.repo.toLowerCase()));
  const maintainedOnly = maintainerRepos
    .filter((repo) => !shownRepos.has(repo.toLowerCase()))
    .map(maintainerOnlyRepo);
  // Stamp each maintained repo with its own maintainer-cut share up front, so the
  // card can show per-repo maintainer emission (e.g. MkDev11's gittensor-hub cut,
  // which has no contributor score of its own) AND the τ/day ordering below counts
  // the cut, not just the PR/issue shares.
  for (const row of [...earningRepos.filter(isMaintained), ...maintainedOnly]) {
    row.maintainerTaoShare = maintainerShareFor(row.repo);
  }
  // Rescale the model breakdown onto the actual headline (no-op when taoScale === 1)
  // so every per-repo τ/day and split-bar segment sums to the authoritative total.
  // Mutates the derived RepoSignals in place — earningRepos are references into
  // `rows`; maintainedOnly are their own objects, so scale both.
  if (taoScale !== 1) {
    for (const row of rows) {
      row.prTaoShare *= taoScale;
      row.issueTaoShare *= taoScale;
      row.maintainerTaoShare *= taoScale;
    }
    for (const row of maintainedOnly) {
      row.prTaoShare *= taoScale;
      row.issueTaoShare *= taoScale;
      row.maintainerTaoShare *= taoScale;
    }
  }
  const prTaoShareScaled = prTaoShare * taoScale;
  const issueTaoShareScaled = issueTaoShare * taoScale;
  const maintainerTaoShareScaled = maintainerTaoShare * taoScale;
  // Order by the miner's per-repo emission (τ/day), highest first — the headline
  // number on each row. repoStreamShare is τ/day without the constant subnetTAO
  // multiplier, so the order is stable whether or not live subnet TAO has loaded.
  const byEmission = (a: RepoSignal, b: RepoSignal) =>
    repoStreamShare(b) - repoStreamShare(a) || a.repo.localeCompare(b.repo);
  // Maintainer-cut repos are a headline reward stream (the card badges the cut),
  // so keep them pinned to the front — otherwise a maintained repo the miner
  // barely contributes to (e.g. MkDev11/gittensor-hub) can fall outside the shown
  // few, leaving the "maintainer cut" badge with no matching repo. Pure-cut repos
  // with no activity row follow, then the rest — each group ordered by τ/day.
  const topRepos = [
    ...earningRepos.filter(isMaintained).sort(byEmission),
    ...maintainedOnly.sort(byEmission),
    ...earningRepos.filter((row) => !isMaintained(row)).sort(byEmission),
  ].slice(0, 4);
  // Full earning count (may exceed the few shown) so the card can note "+N more".
  const earningRepoCount = earningRepos.length + maintainedOnly.length;
  // Active contributions not yet earning — the "almost earning" growth list,
  // most-lucrative repos first so the best opportunities surface.
  const blockedAll = rows
    .filter((row) => isBlockedContribution(row, isMaintained(row)))
    .sort((a, b) => b.emissionShare - a.emissionShare || repoStrength(b) - repoStrength(a));
  const blockedRepoCount = blockedAll.length;
  const blockedRepos = blockedAll.slice(0, 3);
  const activity =
    totalScore * 1.1 + issueScore * 1.25 + usdPerDay * 100 + totalPrs * 3 + totalIssues * 2 + rows.length * 3;

  return {
    miner,
    key: githubId || login || String(miner.uid ?? ''),
    login,
    githubId,
    uid: Number.isFinite(num(miner.uid)) ? num(miner.uid) : null,
    hotkey,
    avatarUrl: `https://github.com/${encodeURIComponent(login)}.png?size=96`,
    rows,
    topRepos,
    earningRepoCount,
    blockedRepos,
    blockedRepoCount,
    totalScore,
    issueScore,
    usdPerDay,
    taoPerDay,
    totalPrs,
    totalIssues,
    prOpen,
    prMerged,
    prClosed,
    issueOpen,
    issueClosed,
    issueCompleted,
    validSolvedIssues,
    uniqueRepos,
    baseScore,
    collateralScore,
    tokenScore,
    nodesScored,
    structuralCount,
    structuralScore,
    leafCount,
    leafScore,
    additions,
    deletions,
    prCred,
    issueCred,
    prEligible,
    issueEligible,
    prEarning,
    issueEarning,
    isMaintainer,
    maintainerRepos,
    maintainerCut,
    maintainerTaoShare: maintainerTaoShareScaled,
    prTaoShare: prTaoShareScaled,
    issueTaoShare: issueTaoShareScaled,
    failedReason: miner.failedReason ?? wire.failed_reason ?? null,
    activity,
  };
}

/** PR / Issue / Dual / Inactive label, by what the miner actually EARNS from
 * (eligibility AND'd with each repo's emission share) — so a miner eligible for
 * issue discovery only on share-0 repos reads as PR, not Dual. */
export function eligibilityLabel(view: MinerView): string {
  if (view.prEarning && view.issueEarning) return 'Dual';
  if (view.issueEarning) return 'Issue';
  if (view.prEarning) return 'PR';
  return 'Inactive';
}

/** A note for the one genuinely confusing card (matthewevans): a standout pile of
 * registered issues that earns nothing. Issue discovery only pays when a repo
 * allocates part of its emission to it (issue_discovery_share > 0) AND the miner
 * clears the bar (3+ valid solved issues at 80%+ issue credibility) — so a big
 * issue count on PR-only repos pays $0. Deliberately rare: only a standout issue
 * count trips it, so the many modest not-yet-eligible contributors stay un-noted. */
export function incentiveNote(view: MinerView): string | null {
  // Standout issue pile AND contributions earn nothing (PR-earners with idle
  // issues aren't confusing — they clearly earn). Catches matthewevans whether
  // he's at 0 or earning only the maintainer cut; excludes ordinary PR earners.
  if (view.totalIssues < 100 || view.prEarning || view.issueEarning) return null;
  const paysDiscovery = view.rows.some((row) => row.issueDiscoveryShare > 0);
  return paysDiscovery
    ? `${view.totalIssues} issues registered, but none earn yet — issue discovery needs 3+ valid solved issues at 80%+ issue credibility.`
    : `${view.totalIssues} issues registered, but they earn nothing — none of these repos allocate emission to issue discovery.`;
}

// ─── Sorting + ranking ────────────────────────────────────────────────────────

function metricFor(view: MinerView, key: SortKey): number {
  if (key === 'score') return view.totalScore + view.issueScore;
  if (key === 'earnings') return view.usdPerDay;
  if (key === 'repos') return view.rows.length;
  if (key === 'activity') return view.activity;
  return 0;
}

export function rankMap(views: MinerView[], key: SortKey): Map<string, number> {
  const sorted = [...views].sort((a, b) => metricFor(b, key) - metricFor(a, key) || a.login.localeCompare(b.login));
  return new Map(sorted.map((view, index) => [view.key, index + 1]));
}

export function compareViews(sortKey: SortKey, sortDir: SortDir) {
  return (a: MinerView, b: MinerView) => {
    let cmp = 0;
    if (sortKey === 'activity') cmp = a.activity - b.activity;
    if (sortKey === 'earnings') cmp = a.usdPerDay - b.usdPerDay;
    if (sortKey === 'score') cmp = a.totalScore + a.issueScore - (b.totalScore + b.issueScore);
    if (sortKey === 'repos') cmp = a.rows.length - b.rows.length;
    if (sortKey === 'name') cmp = a.login.toLowerCase().localeCompare(b.login.toLowerCase());
    if (cmp === 0) cmp = a.activity - b.activity || a.usdPerDay - b.usdPerDay || a.login.localeCompare(b.login);
    return sortDir === 'desc' ? -cmp : cmp;
  };
}

// ─── Emission pool (treemap) ───────────────────────────────────────────────────

/** Live SN74 emission feed (proxied from TaoMarketCap via /api/sn74-emission). */
export interface EmissionData {
  totalTaoPerDay?: number | null;
  minerTaoPerDay?: number | null;
  validatorTaoPerDay?: number | null;
  recycleTaoPerDay?: number | null;
  treasuryTaoPerDay?: number | null;
  /** Per-UID sum of active (non-recycle, non-treasury) miner alpha → TAO. With
   * recycle + treasury it forms the per-repo TAO base (`subnetTAO`). */
  activeMinerTaoPerDay?: number | null;
  ownerTaoPerDay?: number | null;
  minerCount?: number | null;
  validatorCount?: number | null;
  /** Per-UID actual daily TAO (alpha_per_day × price) — exactly what TaoMarketCap
   * shows. `minerView` uses each miner's uid entry as the authoritative headline
   * emission; the score-share model only approximates it (runs a few % high). */
  perUidTaoPerDay?: Record<number, number> | null;
}

/** The per-repo TAO base — the slice of subnet emission the protocol formula
 *  `emissionShare × OSS_POOL` is a fraction of (active-miner UIDs + recycle UID 0
 *  + treasury UID 111). Matches the repositories page's `subnetTAO` exactly so
 *  per-repo emission agrees across both surfaces. Falls back to half the total
 *  subnet emission (the ~50/50 chain split) while the breakdown is loading. */
export function subnetTaoBase(emission: EmissionData | null | undefined): number {
  const active = num(emission?.activeMinerTaoPerDay);
  const recycle = num(emission?.recycleTaoPerDay);
  const treasury = num(emission?.treasuryTaoPerDay);
  if (active > 0 || recycle > 0 || treasury > 0) return active + recycle + treasury;
  return num(emission?.totalTaoPerDay) / 2;
}

export type PoolTileKind = 'miner' | 'others';

/** One tile in the miner treemap. Miners carry a `view`; the aggregate
 *  "others" tile (smaller earners beyond the cap) doesn't. The on-chain sinks
 *  (recycle UID 0, treasury UID 111) are NOT tiles — they'd dwarf the miners —
 *  they live in the allocation bar above the map instead. */
export interface PoolTile {
  key: string;
  kind: PoolTileKind;
  /** Daily TAO emission — the area weight. */
  tao: number;
  /** Daily USD emission (the miner's, or the aggregate for "others"). */
  usd: number;
  view: MinerView | null;
  label: string;
  sub: string;
  /** 1-based rank among miners by TAO; 0 for the "others" tile. */
  rank: number;
  /** Miner count represented (1 for a single miner, N for the "others" tile). */
  count: number;
  /** Representative avatar URLs — the largest few miners folded into the "others"
   *  tile, used to render its face mosaic. Empty for single-miner tiles. */
  avatars: string[];
}

/**
 * Build the miner slice of the emission pool as treemap tiles, weighted by
 * daily TAO. The top `maxMinerTiles` miners get their own tile; the remaining
 * earners fold into a single "others" tile so the miner slice stays whole.
 */
export function buildPoolTiles(views: MinerView[], maxMinerTiles = 56): PoolTile[] {
  const earners = views
    .filter((v) => v.taoPerDay > 0)
    .sort((a, b) => b.taoPerDay - a.taoPerDay || a.login.localeCompare(b.login));

  const tiles: PoolTile[] = earners.slice(0, maxMinerTiles).map((v, i) => ({
    key: v.key,
    kind: 'miner',
    tao: v.taoPerDay,
    usd: v.usdPerDay,
    view: v,
    label: v.login,
    sub: `uid ${v.uid ?? '-'}`,
    rank: i + 1,
    count: 1,
    avatars: [],
  }));

  const rest = earners.slice(maxMinerTiles);
  const restTao = rest.reduce((sum, v) => sum + v.taoPerDay, 0);
  const restUsd = rest.reduce((sum, v) => sum + v.usdPerDay, 0);
  if (rest.length > 0 && restTao > 0) {
    tiles.push({
      key: '__others',
      kind: 'others',
      tao: restTao,
      usd: restUsd,
      view: null,
      label: 'Others',
      sub: `${rest.length} more`,
      rank: 0,
      count: rest.length,
      // The largest few tail miners (rest is already sorted by TAO desc).
      avatars: rest.slice(0, 4).map((v) => v.avatarUrl),
    });
  }

  return tiles;
}
