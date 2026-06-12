// Per-repo "maintainer performance" scorecard, computed from the densely-
// populated issue/PR timestamps the poller caches (created_at / merged_at /
// closed_at). We deliberately do NOT lean on `issue_comments` for a time-to-
// first-response figure: that table is sparse (only a few repos have comment
// data), so a comment-derived metric would silently read as "instant" for every
// repo we haven't fetched comments for. The timestamp metrics below exist for
// every tracked repo.
//
// Scope: figures are restricted to **registered Gittensor miners' work** when a
// miner login set is supplied — the local `pulls`/`issues` tables hold every
// GitHub contributor, but only miner PRs/issues are relevant to the subnet. A
// repo with `issueDiscoveryShare > 0` rewards miners for *finding* issues, so
// the issue-responsiveness figures (over miner-opened issues) are first-class
// there, not just PR review speed.
//
// The figures answer "how well is this repo's maintainer serving miners?":
//   • Review speed   — how fast miner PRs get merged (the headline).
//   • Throughput      — how much miner work gets merged / closed.
//   • Backlog health  — how much miner work is piling up and how old it is.
import Database from 'better-sqlite3';
import type { MaintainerStats } from './api-types';

export type { MaintainerStats } from './api-types';

/** Default window for the headline review-speed figure — recent behaviour, in
 *  step with the rest of the dashboard's 30-day activity windows. */
export const REVIEW_WINDOW_DAYS = 30;
/** An open PR older than this counts as "stale" — a contributor left waiting. */
export const STALE_PR_DAYS = 30;

export interface MaintainerStatsOptions {
  /** Lowercased GitHub usernames of registered Gittensor miners. When provided,
   *  only their PRs/issues are counted. `null` = count every contributor (used
   *  as a graceful fallback when the upstream miner list is unavailable). */
  minerLogins: Set<string> | null;
  /** Lowercased GitHub usernames of the repo's maintainers. When provided, their
   *  own PRs/issues are excluded so the figures measure responsiveness to *other*
   *  miners — a maintainer self-merging their own PR shouldn't read as fast
   *  review. Omit/null to count maintainer work too (the prior behaviour). */
  maintainerLogins?: Set<string> | null;
  /** Headline review-speed window, in days. Defaults to {@link REVIEW_WINDOW_DAYS}. */
  windowDays?: number;
  /** Repo's issue-discovery emission share (0..1). Defaults to 0. */
  issueDiscoveryShare?: number;
}

/** Linear-interpolated percentile over an unsorted sample. `p` in [0,1].
 *  Returns null for an empty sample. Mutates nothing (sorts a copy). */
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

const median = (values: number[]): number | null => percentile(values, 0.5);

const ratio = (num: number, denom: number): number | null => (denom > 0 ? num / denom : null);

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function computeMaintainerStats(
  db: Database.Database,
  repo: string,
  opts: MaintainerStatsOptions,
): MaintainerStats {
  const windowDays = opts.windowDays ?? REVIEW_WINDOW_DAYS;
  const minerLogins = opts.minerLogins;
  const issueDiscoveryShare = opts.issueDiscoveryShare ?? 0;
  const now = Date.now();
  const windowStart = now - windowDays * DAY_MS;
  const day30Start = now - 30 * DAY_MS;
  const staleBefore = now - STALE_PR_DAYS * DAY_MS;

  // Filter to registered miners (when we have the list). A null set means the
  // upstream feed was unavailable — fall back to counting everyone rather than
  // showing an empty scorecard.
  const isMiner = (login: string | null): boolean => {
    if (!minerLogins) return true;
    if (!login) return false;
    return minerLogins.has(login.toLowerCase());
  };
  // Exclude the repo's own maintainers: their self-authored PRs/issues aren't
  // "responsiveness to miners" and would otherwise inflate the speed figures
  // (e.g. a maintainer instantly merging their own PR). No-op when unset.
  const maintainerLogins = opts.maintainerLogins;
  const isMaintainer = (login: string | null): boolean => {
    if (!maintainerLogins || !login) return false;
    return maintainerLogins.has(login.toLowerCase());
  };
  const counts = (login: string | null): boolean => isMiner(login) && !isMaintainer(login);
  const parseMs = (iso: string | null): number => (iso ? Date.parse(iso) : NaN);

  // --- PRs --------------------------------------------------------------------
  const pullRows = db
    .prepare(
      `SELECT author_login AS login, merged, state, draft,
              created_at AS createdAt, merged_at AS mergedAt, closed_at AS closedAt
       FROM pulls WHERE repo_full_name = ?`,
    )
    .all(repo) as Array<{
    login: string | null;
    merged: number;
    state: string;
    draft: number;
    createdAt: string | null;
    mergedAt: string | null;
    closedAt: string | null;
  }>;

  let minerPullRows = 0; // miner PRs seen (drives hasData)
  let mergedAllContributors = 0; // every merge — denominator for the miner share
  let mergedTotal = 0; // miner merges
  let merged30 = 0;
  let closedUnmerged = 0;
  let openPrs = 0;
  let stalePrs = 0;
  const allMergeHours: number[] = [];
  const windowMergeHours: number[] = [];
  const openAgeDays: number[] = [];
  // Time-to-decision: every PR that reached a verdict (merged OR closed-unmerged),
  // timed to merged_at or closed_at. Credits fast rejections, which merge time misses.
  const allDecisionHours: number[] = [];
  const windowDecisionHours: number[] = [];

  for (const p of pullRows) {
    if (p.merged === 1) mergedAllContributors++;
    if (!counts(p.login)) continue;
    minerPullRows++;
    const createdMs = parseMs(p.createdAt);

    if (p.merged === 1) {
      mergedTotal++;
      const mergedMs = parseMs(p.mergedAt);
      if (Number.isFinite(mergedMs)) {
        if (mergedMs >= day30Start) merged30++;
        if (Number.isFinite(createdMs)) {
          const hours = Math.max(0, (mergedMs - createdMs) / HOUR_MS);
          allMergeHours.push(hours);
          if (mergedMs >= windowStart) windowMergeHours.push(hours);
          allDecisionHours.push(hours);
          if (mergedMs >= windowStart) windowDecisionHours.push(hours);
        }
      }
      continue;
    }
    // Unmerged. closed → resolved-but-rejected; open non-draft → backlog.
    if (p.state === 'closed') {
      closedUnmerged++;
      const closedMs = parseMs(p.closedAt);
      if (Number.isFinite(closedMs) && Number.isFinite(createdMs)) {
        const hours = Math.max(0, (closedMs - createdMs) / HOUR_MS);
        allDecisionHours.push(hours);
        if (closedMs >= windowStart) windowDecisionHours.push(hours);
      }
    } else if (p.state === 'open' && p.draft === 0) {
      openPrs++;
      if (Number.isFinite(createdMs)) {
        openAgeDays.push(Math.max(0, (now - createdMs) / DAY_MS));
        if (createdMs < staleBefore) stalePrs++;
      }
    }
  }

  // --- Issues (miner-opened — the issue-discovery contributions) --------------
  // For issue-discovery the *scored* work is an issue closed as `completed`
  // (resolved by a merged PR), not merely closed: a `not_planned`/`duplicate`
  // close is the maintainer rejecting the discovery. So the headline speed
  // (time-to-close) is measured over completed issues only, and the success
  // signal is a completion rate (completed / all), distinct from the raw close
  // rate. Mixing rejections in would (a) drag the median toward how fast junk
  // gets bounced and (b) make a high "% closed" read as healthy when half of it
  // is "no, not planned". See verify against entrius/allways.
  const issueRows = db
    .prepare(
      `SELECT author_login AS login, state, state_reason AS reason,
              created_at AS createdAt, closed_at AS closedAt
       FROM issues WHERE repo_full_name = ?`,
    )
    .all(repo) as Array<{ login: string | null; state: string; reason: string | null; createdAt: string | null; closedAt: string | null }>;

  let minerIssueRows = 0;
  let closedIssues = 0; // every closed miner issue (any reason) — volume context
  let completedIssues = 0; // closed as `completed` — the scored discoveries
  let openIssues = 0;
  let issuesClosed30 = 0;
  let issuesCompleted30 = 0; // closed as `completed` within 30d — resolved throughput
  const issueCloseDays: number[] = []; // completed-only
  const allCloseHours: number[] = []; // completed-only
  const windowCloseHours: number[] = []; // completed-only

  for (const it of issueRows) {
    if (!counts(it.login)) continue;
    minerIssueRows++;
    if (it.state === 'closed') {
      closedIssues++;
      const closedMs = parseMs(it.closedAt);
      const createdMs = parseMs(it.createdAt);
      if (closedMs >= day30Start) issuesClosed30++;
      // Only `completed` closes count toward the time-to-resolve headline.
      if (it.reason === 'completed') {
        completedIssues++;
        if (closedMs >= day30Start) issuesCompleted30++;
        if (Number.isFinite(closedMs) && Number.isFinite(createdMs)) {
          const hours = Math.max(0, (closedMs - createdMs) / HOUR_MS);
          issueCloseDays.push(hours / 24);
          allCloseHours.push(hours);
          if (closedMs >= windowStart) windowCloseHours.push(hours);
        }
      }
    } else if (it.state === 'open') {
      openIssues++;
    }
  }

  const resolvedPrs = mergedTotal + closedUnmerged;

  return {
    repo,
    generatedAt: new Date(now).toISOString(),
    hasData: minerPullRows > 0 || minerIssueRows > 0,
    minerFiltered: minerLogins != null,
    issueDiscoveryShare,
    issueDiscoveryEnabled: issueDiscoveryShare > 0,
    reviewSpeed: {
      windowDays,
      sampleSize: windowMergeHours.length,
      medianHoursToMerge: median(windowMergeHours),
      p90HoursToMerge: percentile(windowMergeHours, 0.9),
      allTimeSampleSize: allMergeHours.length,
      allTimeMedianHoursToMerge: median(allMergeHours),
    },
    decisionSpeed: {
      windowDays,
      sampleSize: windowDecisionHours.length,
      medianHoursToDecision: median(windowDecisionHours),
      p90HoursToDecision: percentile(windowDecisionHours, 0.9),
      allTimeSampleSize: allDecisionHours.length,
      allTimeMedianHoursToDecision: median(allDecisionHours),
    },
    issueResponse: {
      windowDays,
      sampleSize: windowCloseHours.length,
      medianHoursToClose: median(windowCloseHours),
      p90HoursToClose: percentile(windowCloseHours, 0.9),
      allTimeSampleSize: allCloseHours.length,
      allTimeMedianHoursToClose: median(allCloseHours),
    },
    throughput: {
      mergedPrs30d: merged30,
      mergedPrsTotal: mergedTotal,
      issuesClosed30d: issuesClosed30,
      issuesCompleted30d: issuesCompleted30,
      resolvedPrs,
      mergeRate: ratio(mergedTotal, resolvedPrs),
      minerMergeShare: minerLogins ? ratio(mergedTotal, mergedAllContributors) : null,
    },
    backlog: {
      openPrs,
      medianOpenPrAgeDays: median(openAgeDays),
      p90OpenPrAgeDays: percentile(openAgeDays, 0.9),
      oldestOpenPrDays: openAgeDays.length ? Math.max(...openAgeDays) : null,
      stalePrs,
      staleThresholdDays: STALE_PR_DAYS,
      openIssues,
    },
    responsiveness: {
      closedIssues,
      completedIssues,
      medianIssueCloseDays: median(issueCloseDays),
      issueCloseRate: ratio(closedIssues, closedIssues + openIssues),
      // Of every miner-discovered issue, the share that became real solved work.
      // The honest success signal — a fast `not_planned` close inflates closeRate
      // but not this.
      completionRate: ratio(completedIssues, closedIssues + openIssues),
    },
  };
}
