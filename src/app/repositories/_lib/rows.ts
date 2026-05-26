/* Build `RepoRow[]` from the merged Sn74Repo (policy) + GtRepo (stats) inputs.
 *
 * The HTML used hardcoded sample data; here we plug the live data into the
 * same shape. Fields that the API doesn't yet provide (e.g. median merge
 * time, daily sparkline, per-user open PR counts) get reasonable defaults so
 * helpers downstream don't blow up. */

import type { GtRepo } from '@/types/entities';
import type { Sn74Repo } from '@/lib/repos';
import { DEFAULT_ELIGIBILITY, resolveEligibility } from '@/lib/incentives';
import type { RepoRow } from './incentives';

/** Lowercased repo full-name key, for case-insensitive joins/lookups. */
export function lowerName(full: string): string {
  return full.toLowerCase();
}

/** Build a 30-bar sparkline (per-day PR creation counts, oldest first).
 *  Prefers the real `dailyPrs30d` from the API; falls back to the 14-day
 *  array padded with zeros if only the older field is present; ultimately
 *  falls back to flat-per-week from the weekly aggregates. */
function buildSpark(stat: GtRepo): number[] {
  const real30 = stat.dailyPrs30d;
  if (real30 && real30.length === 30) return real30.slice();
  const real14 = stat.dailyPrs14d;
  if (real14 && real14.length === 14) {
    // Pad to 30 with zeros for the older 16 days we don't have
    return new Array(16).fill(0).concat(real14);
  }
  const w1 = Math.max(0, (stat.prsLastWeek ?? 0) / 7);
  const w2 = Math.max(0, (stat.prsThisWeek ?? 0) / 7);
  const out: number[] = new Array(16).fill(0);
  for (let i = 0; i < 7; i++) out.push(w1);
  for (let i = 0; i < 7; i++) out.push(w2);
  return out;
}

/** Build the 30-day issue sparkline (oldest first). Reads from
 *  /api/repos/metadata's `dailyIssues30d` (any GitHub issue opened on
 *  the repo — what "Contributions" intuitively means). Returns zeros
 *  when metadata hasn't loaded yet OR when the GitHub fetch failed for
 *  this repo; the partial-refresh helper on the server will backfill.
 *  We deliberately keep issue-volume data on the metadata route so every
 *  card uses the same GitHub search source for "issues opened". */
function buildIssueSpark(_stat: GtRepo, meta: RepoMeta | undefined): number[] {
  const fromMeta = meta?.dailyIssues30d;
  if (fromMeta && fromMeta.length === 30) return fromMeta.slice();
  return new Array(30).fill(0);
}

/** Extract a tidy `Record<string, number>` of eligibility overrides for the
 *  drawer's "Eligibility gate" section, or null if every field matches the
 *  protocol default. The HTML prototype only flagged repos like `oc-1` that
 *  meaningfully override the gate; the live API populates these fields with
 *  default values for normal repos, so checking null-vs-non-null isn't
 *  enough — we have to compare against the resolved defaults. */
function pickEligibilityOverrides(policy: Sn74Repo): Record<string, number> | null {
  const resolved = resolveEligibility(policy.eligibility);
  const out: Record<string, number> = {};
  const cmp = <K extends keyof typeof DEFAULT_ELIGIBILITY>(key: K, snake: string) => {
    if (resolved[key] !== DEFAULT_ELIGIBILITY[key]) out[snake] = resolved[key];
  };
  cmp('minValidMergedPrs',          'min_valid_merged_prs');
  cmp('minCredibility',             'min_credibility');
  cmp('minValidSolvedIssues',       'min_valid_solved_issues');
  cmp('minIssueCredibility',        'min_issue_credibility');
  cmp('excessivePrPenaltyBaseThreshold', 'excessive_pr_penalty_base_threshold');
  cmp('openIssueSpamBaseThreshold', 'open_issue_spam_base_threshold');
  cmp('maxOpenPrThreshold',         'max_open_pr_threshold');
  cmp('maxOpenIssueThreshold',      'max_open_issue_threshold');
  return Object.keys(out).length > 0 ? out : null;
}

/** Client-side shadow of /api/repos/metadata's RepoMeta. Keep field
 *  optionality in sync with the server interface in
 *  src/app/api/repos/metadata/route.ts to avoid silently accepting
 *  null/undefined when the server is supposed to always emit. */
export interface RepoMeta {
  description: string;
  langs: Array<[string, number]>;
  /** Live open PR count from GitHub. Optional only because older
   *  cached responses (pre-deploy) may not have it. */
  openPrCount?: number;
  /** Daily GitHub issue-creation counts for the last 30 days (oldest
   *  first, length 30). Powers the Contributions chart's lower half
   *  with the broader "any issue opened on the repo" data, rather than
   *  the narrower bounty-issues feed. Always emitted by the server
   *  (zeroed on failure), so required here. */
  dailyIssues30d: number[];
}

export interface MergeOptions {
  /** Lowercased fullName of the "self" repo (highlighted in the UI). */
  selfFullName?: string | null;
  /** Per-repo description + languages from /api/repos/metadata. Empty by
   *  default — fields are populated lazily once that endpoint resolves. */
  metadata?: Record<string, RepoMeta> | null;
}

export function buildRows(
  policies: Sn74Repo[],
  stats: GtRepo[],
  opts: MergeOptions = {},
): RepoRow[] {
  const self = opts.selfFullName?.toLowerCase() ?? null;
  const meta = opts.metadata ?? null;
  const byName = new Map<string, RepoRow>();

  for (const policy of policies) {
    const key = lowerName(policy.fullName);
    const labelMults = policy.labelMultipliers ?? null;
    const labels = labelMults && Object.keys(labelMults).length > 0 ? labelMults : null;
    const maintCut = policy.maintainerCut ?? 0;
    byName.set(key, {
      fullName: policy.fullName,
      owner: policy.owner,
      name: policy.name,
      policy,
      stats: null,
      share: policy.weight,
      issue: policy.issueDiscoveryShare ?? 0,
      maintCut,
      trusted: policy.trustedLabelPipeline ?? false,
      // Validators haven't seeded maintainer counts yet, so we default to 1
      // when a cut is configured and flag it as `demoMaint` so the UI can
      // call that out (the HTML prototype did the same).
      maintainerCount: maintCut > 0 ? 1 : 0,
      demoMaint: maintCut > 0,
      labels,
      defaultLabel: policy.defaultLabelMultiplier ?? 1.0,
      eligibility: pickEligibilityOverrides(policy),
      fixedBase: policy.fixedBaseScore ?? null,
      isSelf: self != null && key === self,
      activity: {
        merged30d: 0,
        closed30d: 0,
        openPRs: Math.max(0, meta?.[key]?.openPrCount ?? 0),
        openPRs30d: 0,
        contribs: 0,
        spark: new Array(30).fill(0),
        sparkIssues: new Array(30).fill(0),
        medianMergeHours: null,
        userOpenPRs: 0,
      },
      langs: meta?.[policy.fullName.toLowerCase()]?.langs ?? [],
      description: meta?.[policy.fullName.toLowerCase()]?.description ?? '',
      isActive: !policy.inactiveAt && policy.weight > 0,
      inactiveAt: policy.inactiveAt,
    });
  }

  for (const stat of stats) {
    const key = lowerName(stat.fullName);
    const row = byName.get(key);
    // Open PRs come from /api/repos/metadata (live GitHub count). Falls
    // back to 0 only while that endpoint hasn't responded yet.
    const openPRs = Math.max(0, meta?.[key]?.openPrCount ?? 0);
    // True 30-day window (filtered by prCreatedAt in the API route).
    // Falls back to lifetime totals only if the route hasn't been deployed
    // with the new fields yet, in which case we still strip openPRs from
    // the closed bucket to avoid the old double-count bug.
    const has30d = typeof stat.prsLast30d === 'number' && typeof stat.mergedLast30d === 'number';
    const merged30d = has30d ? (stat.mergedLast30d ?? 0) : stat.mergedPrCount;
    const closed30d = has30d
      ? (stat.closedLast30d ?? 0)
      : Math.max(0, stat.totalPrCount - stat.mergedPrCount - openPRs);
    const contribs = has30d ? (stat.contributorsLast30d ?? 0) : stat.contributorCount;
    // PRs created in the 30d window that are still open today. Derived
    // from the API totals so the activity card stays window-consistent
    // (otherwise "171 open" would dwarf "107 merged · 30d" because the
    // live open count includes long-running PRs from outside the window).
    const openPRs30d = has30d
      ? Math.max(0, (stat.prsLast30d ?? 0) - merged30d - closed30d)
      : openPRs;
    if (row) {
      row.stats = stat;
      row.activity = {
        ...row.activity,
        merged30d,
        closed30d,
        openPRs,
        openPRs30d,
        contribs,
        spark: buildSpark(stat),
        sparkIssues: buildIssueSpark(stat, meta?.[key]),
      };
      row.isActive = stat.isActive;
      row.inactiveAt = stat.inactiveAt ?? row.inactiveAt;
    } else {
      // Stat without a policy entry (rare; would mean GtRepo lists something
      // sn74-repos doesn't). Surface it anyway with zeroed policy fields.
      byName.set(key, {
        fullName: stat.fullName,
        owner: stat.owner,
        name: stat.name,
        policy: null,
        stats: stat,
        share: stat.weight,
        issue: 0,
        maintCut: 0,
        trusted: false,
        maintainerCount: 0,
        demoMaint: false,
        labels: null,
        defaultLabel: 1.0,
        eligibility: null,
        fixedBase: null,
        isSelf: self != null && key === self,
        activity: {
          merged30d,
          closed30d,
          openPRs,
          openPRs30d,
          contribs,
          spark: buildSpark(stat),
          sparkIssues: buildIssueSpark(stat, meta?.[key]),
          medianMergeHours: null,
          userOpenPRs: 0,
        },
        langs: meta?.[stat.fullName.toLowerCase()]?.langs ?? [],
        description: meta?.[stat.fullName.toLowerCase()]?.description ?? '',
        isActive: stat.isActive,
        inactiveAt: stat.inactiveAt,
      });
    }
  }

  return Array.from(byName.values());
}
