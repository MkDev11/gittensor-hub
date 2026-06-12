export interface IssueLinkedPrDto {
  number: number;
  title: string;
  state: string;
  draft: number;
  merged: number;
  author_login: string | null;
  closed_at?: string | null;
  merged_at?: string | null;
  html_url?: string | null;
}

export interface IssueDto {
  id: number;
  repo_full_name: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  state_reason: string | null;
  author_login: string | null;
  author_association: string | null;
  labels: Array<{ name: string; color?: string }>;
  comments: number;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  html_url: string | null;
  fetched_at: string;
  first_seen_at: string;
  linked_prs?: IssueLinkedPrDto[];
  linked_pr_count?: number;
  merged_pr_count?: number;
  closed_pr_count?: number;
}

export interface PullDto {
  id: number;
  repo_full_name: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: number;
  merged: number;
  author_login: string | null;
  author_association: string | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  merged_at: string | null;
  html_url: string | null;
  fetched_at: string;
  first_seen_at: string;
  additions?: number | null;
  deletions?: number | null;
  score?: number | null;
  scored?: boolean;
}

export interface IssueStateCounts {
  open: number;
  completed: number;
  not_planned: number;
  /** Closed + state_reason='duplicate'. Gittensor rule treats these as not
   *  solved, separate from the generic "closed (other)" bucket. */
  duplicate: number;
  closed: number;
  /** @deprecated use `closed` */
  closed_other: number;
}

export interface IssuesResponse {
  repo: string;
  count: number; // total matching the current filter (page-independent)
  state_counts: IssueStateCounts;
  new_count?: number; // populated when ?since=ISO is sent
  last_fetch: string | null;
  last_error: string | null;
  issues: IssueDto[]; // current page only
  /** Linked PRs (closes/fixes/sidebar-linked) for issues on this page only. */
  linked_prs_by_issue?: Record<
    number,
    Array<{ number: number; title: string; state: string; draft: number; merged: number; author_login: string | null }>
  >;
  /** Per-author OPEN/DONE/NP/CL counts for authors of issues on this page. */
  page_author_stats?: Record<string, AuthorIssueStats>;
  /** Per-user valid/invalid marks for issues on this page (only set when signed in). */
  user_validations?: Record<number, 'valid' | 'invalid'>;
}

export interface PullStateCounts {
  open: number;
  draft: number;
  merged: number;
  closed: number;
}

export interface PullsResponse {
  repo: string;
  count: number;
  state_counts: PullStateCounts;
  new_count?: number;
  last_fetch: string | null;
  last_error: string | null;
  pulls: PullDto[];
  /** Linked issues (closes/fixes/sidebar-linked) for PRs on this page only. */
  linked_issues_by_pull?: Record<
    number,
    Array<{ number: number; title: string; state: string; state_reason: string | null; author_login: string | null }>
  >;
}

export interface AuthorOption {
  login: string;
  count: number;
  /** Per-author state-bucket counts. Populated by /issues-meta when the
   * dropdown asks for the full list (summary=1 omits these). */
  open?: number;
  completed?: number;
  not_planned?: number;
  /** Closed + state_reason='duplicate'. Its own bucket — never folded into
   * `closed` — so author badges match the repo-wide `IssueStateCounts`. */
  duplicate?: number;
  closed?: number;
}

export interface AuthorIssueStats {
  open: number;
  completed: number;
  not_planned: number;
  /** Closed + state_reason='duplicate'. See `AuthorOption.duplicate`. */
  duplicate: number;
  closed: number;
}

export interface IssuesMetaResponse {
  repo: string;
  author_options: AuthorOption[];
  author_stats: Record<string, AuthorIssueStats>;
  total_authors: number;
  /** Issue counts grouped by GitHub `author_association`. Powers the
   * "Collaborators" / "Contributors" pseudo-filters at the top of the
   * author dropdown. */
  assoc_counts?: { collaborator: number; contributor: number };
}

export interface PullsMetaResponse {
  repo: string;
  author_options: AuthorOption[];
  total_authors: number;
}

export type PullStatus = 'open' | 'draft' | 'merged' | 'closed';

export function pullStatus(p: PullDto): PullStatus {
  // Precedence: merged → closed → draft → open. A closed unmerged draft counts
  // as `closed` (see pullStatus in src/types/entities.ts and the SQL buckets in
  // src/lib/pull-buckets.ts — all three stay in lockstep).
  if (p.merged) return 'merged';
  if (p.state === 'closed') return 'closed';
  if (p.draft) return 'draft';
  return 'open';
}

// ─── Fairness signals (see src/lib/fairness-signals.ts) ───────────────────────
// Per-miner merge-speed vs the repo baseline — surfaces maintainer fast-tracking
// of favored accounts. Computed from cached PR timestamps; maintainers excluded.

export interface MinerFairnessRow {
  login: string;
  /** Resolved items: merged PRs (pr mode) or completed issues (issue mode). */
  resolved: number;
  /** Rejected: closed-unmerged PRs (pr) / not_planned+duplicate issues (issue). */
  rejected: number;
  /** rejected / (resolved + rejected). null when nothing resolved. */
  rejectRate: number | null;
  /** Median time-to-resolve for this miner's resolved items, hours (PR: open→
   *  merge; issue: open→completed-close). */
  medianTtmHours: number;
  /** (repoMedian − minerMedian) / repoMedian — signed; positive = faster than
   *  the repo baseline. null when there's no baseline. */
  deltaVsRepoMedian: number | null;
  /** medianTtm < repo baseline — the "fast-tracked" highlight. */
  fasterThanRepo: boolean;
}

export interface FairnessSignals {
  repo: string;
  /** `pr` ranks PR-merge speed; `issue` ranks issue-completion speed (used on
   *  pure issue-discovery repos where merges aren't the scored work). */
  mode: 'pr' | 'issue';
  /** Pooled median time-to-resolve over every non-maintainer miner item (hours). */
  repoMedianTtmHours: number | null;
  /** Total resolved items behind the baseline. */
  resolvedSample: number;
  /** Distinct non-maintainer miners with ≥1 resolved item. */
  minerCount: number;
  /** Whether rows were restricted to registered miners. False = miner feed was
   *  unavailable, so every contributor is counted (graceful fallback). */
  minerFiltered: boolean;
  /** Maintainer logins filtered out (for transparency in the UI). */
  maintainersExcluded: number;
  /** Whether maintainer filtering was applied (false = mirror unavailable). */
  maintainerFiltered: boolean;
  /** Fastest-first (shortest median time-to-resolve). */
  miners: MinerFairnessRow[];
}

// ─── Maintainer scorecard (see src/lib/maintainer-stats.ts) ───────────────────
// Kept here (no server deps) so client components can `import type` the shape
// without pulling in the better-sqlite3-backed computation module.

export interface ReviewSpeedStats {
  windowDays: number;
  /** Merges that landed inside the window — the sample the headline is over. */
  sampleSize: number;
  medianHoursToMerge: number | null;
  p90HoursToMerge: number | null;
  /** All-time figures, shown as context beside the recent window. */
  allTimeSampleSize: number;
  allTimeMedianHoursToMerge: number | null;
}

/** Time from a miner PR opening to *any* decision — merged OR closed-unmerged.
 *  Complements {@link ReviewSpeedStats} (merge time only), so a maintainer who
 *  rejects unsuitable PRs quickly still shows up, instead of contributing no
 *  data. Uses COALESCE(merged_at, closed_at) for the decision timestamp. */
export interface DecisionSpeedStats {
  windowDays: number;
  sampleSize: number;
  medianHoursToDecision: number | null;
  p90HoursToDecision: number | null;
  allTimeSampleSize: number;
  allTimeMedianHoursToDecision: number | null;
}

/** Issue-discovery analogue of {@link ReviewSpeedStats}: how fast miner-opened
 *  issues get *resolved* — measured over `completed` closes only (not
 *  `not_planned`/`duplicate`), since a rejection isn't responsiveness to the
 *  discovery. The headline for issue-discovery repos, where PR merges aren't the
 *  scored work. */
export interface IssueResponseStats {
  windowDays: number;
  sampleSize: number;
  medianHoursToClose: number | null;
  p90HoursToClose: number | null;
  allTimeSampleSize: number;
  allTimeMedianHoursToClose: number | null;
}

export interface ThroughputStats {
  mergedPrs30d: number;
  mergedPrsTotal: number;
  /** Closed in the last 30d, any reason (completed + not_planned + duplicate). */
  issuesClosed30d: number;
  /** Closed as `completed` in the last 30d — resolved issue throughput (the
   *  30d analogue of `responsiveness.completedIssues`). */
  issuesCompleted30d: number;
  /** merged + closed-unmerged — the PRs the maintainer has acted on. */
  resolvedPrs: number;
  /** merged / resolved. null when nothing has been resolved yet. */
  mergeRate: number | null;
  /** Gittensor-miner share of ALL merged PRs (miner merges / every merge).
   *  How much of the repo's merge throughput is subnet work. null when no
   *  merges, or when miner filtering is off. */
  minerMergeShare: number | null;
}

export interface BacklogStats {
  openPrs: number;
  medianOpenPrAgeDays: number | null;
  p90OpenPrAgeDays: number | null;
  oldestOpenPrDays: number | null;
  stalePrs: number;
  staleThresholdDays: number;
  openIssues: number;
}

export interface ResponsivenessStats {
  /** Every closed miner issue, any reason (completed / not_planned / duplicate). */
  closedIssues: number;
  /** Closed as `completed` — the issue-discovery work that actually scored. */
  completedIssues: number;
  /** Median time-to-close over `completed` issues only (days). */
  medianIssueCloseDays: number | null;
  /** closed / (closed + open). Includes rejections — context, not a success rate. */
  issueCloseRate: number | null;
  /** completed / (closed + open). The honest "discoveries that became real work"
   *  rate; immune to fast `not_planned` rejections inflating it. null when no issues. */
  completionRate: number | null;
}

export interface MaintainerStats {
  repo: string;
  generatedAt: string;
  /** False when neither a PR nor an issue is cached for the repo. */
  hasData: boolean;
  /** Whether the figures are restricted to registered Gittensor miners' work.
   *  False means the miner list was unavailable and every contributor counts. */
  minerFiltered: boolean;
  /** Repo's issue-discovery emission share (0..1). */
  issueDiscoveryShare: number;
  /** Convenience: issueDiscoveryShare > 0 — the repo rewards issue discovery,
   *  so the issue-responsiveness figures (miner-opened issues) are first-class. */
  issueDiscoveryEnabled: boolean;
  reviewSpeed: ReviewSpeedStats;
  decisionSpeed: DecisionSpeedStats;
  issueResponse: IssueResponseStats;
  throughput: ThroughputStats;
  backlog: BacklogStats;
  responsiveness: ResponsivenessStats;
}

/** Pick the review-speed headline from a {@link MaintainerStats}: the windowed
 *  median when the recent window has merges, otherwise the all-time median.
 *  Shared by the repo drawer scorecard and the compare modal so both surface
 *  the same figure for a repo. */
export function headlineReviewSpeed(s: MaintainerStats): {
  hours: number | null;
  p90Hours: number | null;
  sampleSize: number;
  scope: 'window' | 'all-time';
  windowDays: number;
} {
  const rs = s.reviewSpeed;
  const inWindow = rs.sampleSize > 0;
  return {
    hours: inWindow ? rs.medianHoursToMerge : rs.allTimeMedianHoursToMerge,
    p90Hours: inWindow ? rs.p90HoursToMerge : null,
    sampleSize: inWindow ? rs.sampleSize : rs.allTimeSampleSize,
    scope: inWindow ? 'window' : 'all-time',
    windowDays: rs.windowDays,
  };
}

/** Decision-time analogue of {@link headlineReviewSpeed}: the windowed median
 *  time-to-decision (merge or close) when the window has decisions, else all-time. */
export function headlineDecisionSpeed(s: MaintainerStats): {
  hours: number | null;
  sampleSize: number;
  scope: 'window' | 'all-time';
  windowDays: number;
} {
  const ds = s.decisionSpeed;
  const inWindow = ds.sampleSize > 0;
  return {
    hours: inWindow ? ds.medianHoursToDecision : ds.allTimeMedianHoursToDecision,
    sampleSize: inWindow ? ds.sampleSize : ds.allTimeSampleSize,
    scope: inWindow ? 'window' : 'all-time',
    windowDays: ds.windowDays,
  };
}

/** Issue-response analogue of {@link headlineReviewSpeed}: the windowed median
 *  time-to-close when the window has closes, else all-time. */
export function headlineIssueResponse(s: MaintainerStats): {
  hours: number | null;
  p90Hours: number | null;
  sampleSize: number;
  scope: 'window' | 'all-time';
  windowDays: number;
} {
  const ir = s.issueResponse;
  const inWindow = ir.sampleSize > 0;
  return {
    hours: inWindow ? ir.medianHoursToClose : ir.allTimeMedianHoursToClose,
    p90Hours: inWindow ? ir.p90HoursToClose : null,
    sampleSize: inWindow ? ir.sampleSize : ir.allTimeSampleSize,
    scope: inWindow ? 'window' : 'all-time',
    windowDays: ir.windowDays,
  };
}

/** Review-speed verdict (label + colour) from a median merge time in hours.
 *  Shared by the compare modal, the repo drawer, and the repo-page scorecard so
 *  thresholds and colours stay in lockstep. Plain hex colours so it renders the
 *  same under both the Primer and the repositories-page palettes. */
export function reviewSpeedVerdict(h: number | null): { label: string; color: string; desc: string } {
  if (h == null) return { label: 'unknown',   color: '#62666d', desc: '—' };
  if (h <= 12)   return { label: 'very fast', color: '#22c55e', desc: `~${h}h median` };
  if (h <= 24)   return { label: 'fast',      color: '#86efac', desc: `~${h}h median` };
  if (h <= 48)   return { label: 'normal',    color: '#9eb872', desc: `~${h}h median` };
  if (h <= 96)   return { label: 'slow',      color: '#eab308', desc: `~${Math.round(h / 24)}d median` };
  return           { label: 'very slow', color: '#c5503a', desc: `~${Math.round(h / 24)}d median` };
}

/** Verdict for issue-response time (miner-opened issue → closed). Issues
 *  legitimately take longer than PR merges, so the thresholds are in days,
 *  not hours. Same colour scale as {@link reviewSpeedVerdict}. */
export function issueResponseVerdict(h: number | null): { label: string; color: string; desc: string } {
  if (h == null) return { label: 'unknown',   color: '#62666d', desc: '—' };
  const d = Math.round(h / 24);
  if (h <= 48)    return { label: 'very fast', color: '#22c55e', desc: `~${d <= 1 ? `${Math.round(h)}h` : `${d}d`} median` };
  if (h <= 168)   return { label: 'fast',      color: '#86efac', desc: `~${d}d median` };  // ≤ 1 week
  if (h <= 504)   return { label: 'normal',    color: '#9eb872', desc: `~${d}d median` };  // ≤ 3 weeks
  if (h <= 1080)  return { label: 'slow',      color: '#eab308', desc: `~${d}d median` };  // ≤ ~6 weeks
  return            { label: 'very slow', color: '#c5503a', desc: `~${d}d median` };
}

/** Tick marks for the review-speed gauge (30 min → 30 days). */
export const REVIEW_SPEED_GAUGE_TICKS: ReadonlyArray<{ hours: number; label: string }> = [
  { hours: 0.5, label: '30m' },
  { hours: 6, label: '6h' },
  { hours: 24, label: '1d' },
  { hours: 168, label: '1w' },
  { hours: 720, label: '30d' },
];

/** Log-scaled position (0..1) of a duration on the review-speed gauge — 30 min
 *  at the left edge, 30 days at the right, so the fast end (where most healthy
 *  repos sit) gets the resolution. Shared by the drawer and the repo-page
 *  scorecard so both gauges use one scale. Null for a null/non-finite input. */
export function reviewSpeedGaugePos(hours: number | null | undefined): number | null {
  if (hours == null || !Number.isFinite(hours)) return null;
  const MIN = 0.5;
  const MAX = 720;
  const c = Math.min(Math.max(hours, MIN), MAX);
  return (Math.log(c) - Math.log(MIN)) / (Math.log(MAX) - Math.log(MIN));
}

// ─── Composite maintainer grade (leaderboard / dashboard ranking) ─────────────
// One 0–100 score per maintainer so every repo can be ranked in a single column.
// Deliberately transparent: it reuses the SAME verdict bands as the gauges (no
// new thresholds), scores a PR side and an issue side independently, and blends
// them by issueDiscoveryShare. So a pure-PR repo is graded on PR behaviour, a
// pure issue-discovery repo on issue behaviour, and a mixed repo proportionally.

/** Verdict label → speed sub-score. Maps the five gauge bands onto a 0–100 ramp;
 *  unknown (no sample) → null so it drops out of the blend instead of scoring 0. */
function speedBandScore(label: string): number | null {
  switch (label) {
    case 'very fast': return 95;
    case 'fast':      return 82;
    case 'normal':    return 65;
    case 'slow':      return 40;
    case 'very slow': return 15;
    default:          return null; // 'unknown'
  }
}

/** Weighted mean over only the parts that are present (non-null). Returns null
 *  when nothing is present, so an axis with no data never drags a score to 0. */
function blendPresent(parts: Array<{ v: number | null; w: number }>): number | null {
  let sum = 0, wsum = 0;
  for (const { v, w } of parts) {
    if (v == null || !Number.isFinite(v) || w <= 0) continue;
    sum += v * w; wsum += w;
  }
  return wsum > 0 ? sum / wsum : null;
}

/** Backlog health 0–100 from open-PR age, stale share, and absolute size: full
 *  marks for an empty or fresh queue, docked for a stale-heavy, aging, OR simply
 *  large backlog. Size matters on its own — a 150-deep queue of recent PRs is
 *  still 150 contributors waiting, even if none are "stale" yet. */
function backlogScore(b: BacklogStats): number | null {
  if (b.openPrs === 0) return 100; // nothing pending — caught up
  const staleRatio = b.stalePrs / b.openPrs;            // 0..1
  const age = b.medianOpenPrAgeDays ?? 0;
  const stalePenalty = 45 * staleRatio;                 // up to 45 for an all-stale queue
  const agePenalty = Math.min(30, (age / 30) * 30);     // up to 30 by ~30d median age
  const sizePenalty = Math.min(30, (b.openPrs / 80) * 30); // up to 30, saturating at ~80 open
  return Math.max(0, Math.min(100, 100 - stalePenalty - agePenalty - sizePenalty));
}

/** Below this many gradeable items (resolved PRs + closed issues) a grade is
 *  too thin to trust and is flagged `provisional` — e.g. an A off a single PR. */
export const GRADE_MIN_SAMPLE = 5;

export interface MaintainerGrade {
  /** Blended 0–100, or null when the repo has no gradeable signal yet. */
  score: number | null;
  /** Letter for the blended score. '—' when score is null. */
  letter: 'A' | 'B' | 'C' | 'D' | 'F' | '—';
  /** Resolved PRs + closed issues behind the grade — the evidence count. */
  sample: number;
  /** True when `sample` < {@link GRADE_MIN_SAMPLE}: show muted, sort below
   *  confident grades. The score is still computed, just low-confidence. */
  provisional: boolean;
  /** PR-side breakdown (null when the repo isn't PR-scored or has no PR data). */
  pr: { score: number; speed: number | null; acceptance: number | null; backlog: number | null } | null;
  /** Issue-side breakdown (null when the repo isn't issue-scored or has no data).
   *  `completion` is the completed/total rate (not the raw close rate). */
  issue: { score: number; speed: number | null; completion: number | null } | null;
}

/** Letter from a 0–100 score. Standard A–F bands. */
export function gradeLetter(score: number | null): MaintainerGrade['letter'] {
  if (score == null || !Number.isFinite(score)) return '—';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/** Composite maintainer grade for the leaderboard. PR side blends review speed
 *  (50%), merge acceptance (30%) and backlog health (20%); issue side blends
 *  issue-response speed (60%) and close rate (40%). The two sides combine by
 *  issueDiscoveryShare. Weights favour responsiveness — the headline of the
 *  whole scorecard — then whether work actually lands, then queue hygiene. */
export function maintainerGrade(s: MaintainerStats): MaintainerGrade {
  const share = Math.min(1, Math.max(0, s.issueDiscoveryShare));
  const hasPr = share < 1;
  const hasIssue = share > 0;

  let pr: MaintainerGrade['pr'] = null;
  if (hasPr) {
    const speed = speedBandScore(reviewSpeedVerdict(headlineReviewSpeed(s).hours).label);
    const acceptance = s.throughput.mergeRate != null ? s.throughput.mergeRate * 100 : null;
    const backlog = backlogScore(s.backlog);
    const score = blendPresent([
      { v: speed, w: 0.5 },
      { v: acceptance, w: 0.3 },
      { v: backlog, w: 0.2 },
    ]);
    if (score != null) pr = { score, speed, acceptance, backlog };
  }

  let issue: MaintainerGrade['issue'] = null;
  if (hasIssue) {
    const speed = speedBandScore(issueResponseVerdict(headlineIssueResponse(s).hours).label);
    // Completion rate (completed/total), not the raw close rate — a fast
    // `not_planned` rejection shouldn't earn acceptance credit.
    const completion = s.responsiveness.completionRate != null ? s.responsiveness.completionRate * 100 : null;
    const score = blendPresent([
      { v: speed, w: 0.6 },
      { v: completion, w: 0.4 },
    ]);
    if (score != null) issue = { score, speed, completion };
  }

  const score = blendPresent([
    { v: pr?.score ?? null, w: 1 - share },
    { v: issue?.score ?? null, w: share },
  ]);
  // Evidence behind the grade: resolved PRs on the PR side, closed issues on the
  // issue side, each only counted where that side is actually graded.
  const sample = (hasPr ? s.throughput.resolvedPrs : 0) + (hasIssue ? s.responsiveness.closedIssues : 0);
  return { score, letter: gradeLetter(score), sample, provisional: sample < GRADE_MIN_SAMPLE, pr, issue };
}

// ─── All-maintainers roster (the /maintainers page) ──────────────────────────
// A person-centric companion to the repo-centric leaderboard: every maintainer
// across every tracked repo, with how much work ships through the repos they
// steward. "Shipping" is repo-attributed — GitHub's PR list endpoint omits
// `merged_by`, so we cannot tell which individual merged a given PR; a repo's
// throughput is credited to each of its maintainers. Reward is exact (split
// evenly among a repo's registered miner-maintainers).

/** One repo a maintainer stewards, with that repo's responsiveness + throughput. */
export interface MaintainerRepoContribution {
  repo: string; // owner/name
  issueDiscoveryShare: number;
  /** Fraction (0..1) of the repo's emission reserved for its maintainers — the
   *  lever behind `rewardShare`. */
  maintainerCut: number;
  mode: 'PR' | 'issue' | 'mixed';
  gradeLetter: MaintainerGrade['letter'];
  gradeScore: number | null;
  provisional: boolean;
  /** Headline responsiveness (median hours) for the repo's dominant side. */
  speedHours: number | null;
  mergedPrsTotal: number;
  mergedPrs30d: number;
  /** Issues resolved (closed as `completed`) — all-time and last 30d. */
  issuesCompleted: number;
  issuesResolved30d: number;
  /** This maintainer's τ-fraction from this repo (0 when not a registered miner). */
  rewardShare: number;
  /** Counts toward reward here — i.e. is a registered miner-maintainer of this repo. */
  isRegisteredMaintainer: boolean;
}

/** A maintainer aggregated across every repo they steward. */
export interface MaintainerSummary {
  login: string;
  githubId: string | null;
  /** Is a registered Gittensor miner (and so earns maintainer reward somewhere). */
  registered: boolean;
  repoCount: number;
  repos: MaintainerRepoContribution[];
  // Shipping totals — summed over the repos they steward (repo-attributed).
  // "Shipped" = delivered work: merged PRs + issues resolved as `completed`
  // (rejections like not_planned don't count), consistently in both windows.
  mergedPrsTotal: number;
  mergedPrs30d: number;
  issuesCompletedTotal: number;
  issuesResolved30d: number;
  /** mergedPrs30d + issuesResolved30d — the headline recent-shipping figure. */
  shipped30d: number;
  /** mergedPrsTotal + issuesCompletedTotal — all-time shipped. */
  shippedTotal: number;
  // Blended responsiveness grade across their repos (sample-weighted).
  gradeScore: number | null;
  gradeLetter: MaintainerGrade['letter'];
  gradeSample: number;
  /** Reward τ-fraction; multiply by the live miner-pool τ/day for τ/day. */
  rewardShare: number;
}

/** One maintainer within a repo's roster — the repo-centric ("who maintains
 *  this repo") view, the inverse of {@link MaintainerSummary}. */
export interface RepoMaintainerEntry {
  login: string;
  githubId: string | null;
  /** Registered Gittensor miner — earns the reward split on this repo. */
  registered: boolean;
  /** This maintainer's τ-fraction from this repo (0 when not registered). */
  rewardShare: number;
}

/** A repo with its full maintainer roster + the repo's shipping/grade/reward.
 *  Throughput here is the repo's own (the figure each maintainer is credited
 *  with in the person view). */
export interface RepoMaintainersSummary {
  repo: string; // owner/name
  owner: string;
  name: string;
  issueDiscoveryShare: number;
  maintainerCut: number;
  mode: 'PR' | 'issue' | 'mixed';
  gradeLetter: MaintainerGrade['letter'];
  gradeScore: number | null;
  provisional: boolean;
  speedHours: number | null;
  mergedPrsTotal: number;
  mergedPrs30d: number;
  issuesCompletedTotal: number;
  issuesResolved30d: number;
  shipped30d: number;
  shippedTotal: number;
  /** Total maintainer-pool τ-fraction for the repo (whole pool when it has any
   *  registered maintainer, else 0). Split evenly among its registered ones. */
  rewardShare: number;
  maintainerCount: number;
  maintainers: RepoMaintainerEntry[];
}

export interface MaintainersResponse {
  generatedAt: string;
  /** True when figures are restricted to registered miners' work (false on a
   *  miner-feed outage — every contributor then counts). */
  minerFiltered: boolean;
  /** True when at least one repo's maintainer roster was fetched from the mirror. */
  rosterAvailable: boolean;
  repoCount: number;
  maintainerCount: number;
  /** Person-centric: each maintainer and the repos they steward. */
  maintainers: MaintainerSummary[];
  /** Repo-centric: each repo and its full maintainer roster. */
  repos: RepoMaintainersSummary[];
}
