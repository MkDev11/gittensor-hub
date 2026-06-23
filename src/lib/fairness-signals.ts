// "Fairness signals" — per-miner resolve-speed vs the repo's own baseline, to
// surface maintainers fast-tracking a favored set of accounts (a leading
// indicator of favoritism / sockpuppets / self-dealing) BEFORE a miner invests
// time contributing. Signals to investigate, not verdicts: a flagged miner is
// just an outlier vs this repo's own distribution.
//
// Two modes:
//   • pr   — merged PRs; time-to-resolve = mergedAt − createdAt. The scored work
//            on PR repos.
//   • issue— completed issues; time-to-resolve = closedAt − createdAt. Used on
//            pure issue-discovery repos, where a discovered issue getting closed
//            (completed) is the scored work, not a PR merge.
//
// Per non-maintainer miner with ≥1 resolved item: median time-to-resolve, count,
// reject rate. Repo baseline = pooled median of every counted item's time.
// Median (not mean) so one slow legit item doesn't skew it. Maintainers are
// excluded from both the rows AND the baseline.
import Database from 'better-sqlite3';
import type { FairnessSignals, MinerFairnessRow } from './api-types';
import { hasMergedLinkedPrSql } from './issue-buckets';

export type { FairnessSignals, MinerFairnessRow } from './api-types';

const HOUR_MS = 3_600_000;

/** Linear-interpolated median over an unsorted sample. Null for empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) / 2;
  return (s[Math.floor(i)] + s[Math.ceil(i)]) / 2;
}

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

export interface FairnessOptions {
  /** Lowercased registered miner logins — only their items are counted. `null`
   *  when the upstream feed is unavailable: fall back to counting every
   *  contributor rather than showing an empty card (matches computeMaintainerStats). */
  minerLogins: Set<string> | null;
  /** Lowercased maintainer logins — excluded from rows AND the baseline.
   *  Null when the mirror was unavailable (no exclusion applied). */
  maintainerLogins: Set<string> | null;
  /** `pr` ranks merged-PR speed; `issue` ranks completed-issue speed. */
  mode: 'pr' | 'issue';
}

interface RawItem {
  login: string | null;
  resolved: boolean; // merged PR / completed issue
  rejected: boolean; // closed-unmerged PR / not_planned|duplicate issue
  createdAt: string | null;
  resolvedAt: string | null; // mergedAt / closedAt
}

export function computeFairnessSignals(
  db: Database.Database,
  repo: string,
  opts: FairnessOptions,
): FairnessSignals {
  const { minerLogins, maintainerLogins, mode } = opts;
  // Null miner set = upstream feed unavailable → count every contributor.
  const isMiner = (lc: string): boolean => (minerLogins ? minerLogins.has(lc) : true);
  const isMaintainer = (lc: string): boolean => (maintainerLogins ? maintainerLogins.has(lc) : false);
  const parseMs = (iso: string | null): number => (iso ? Date.parse(iso) : NaN);

  // Normalize PRs/issues into the same shape so the ranking logic is shared.
  let items: RawItem[];
  if (mode === 'issue') {
    const rows = db
      .prepare(
        `SELECT author_login AS login, state, state_reason AS reason,
                created_at AS createdAt, closed_at AS resolvedAt,
                CASE WHEN ${hasMergedLinkedPrSql('issues')} THEN 1 ELSE 0 END AS hasMergedPr
         FROM issues WHERE repo_full_name = ?`,
      )
      .all(repo) as Array<{ login: string | null; state: string; reason: string | null; createdAt: string | null; resolvedAt: string | null; hasMergedPr: number }>;
    items = rows.map((r) => ({
      login: r.login,
      // A completed issue counts as resolved only when backed by a merged linked
      // PR — same definition as issue-buckets.ts and the issues page, so the
      // baseline and per-miner speed aren't polluted by non-PR-backed closes.
      resolved: r.state === 'closed' && r.reason === 'completed' && r.hasMergedPr === 1,
      rejected: r.state === 'closed' && (r.reason === 'not_planned' || r.reason === 'duplicate'),
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    }));
  } else {
    const rows = db
      .prepare(
        `SELECT author_login AS login, merged, state,
                created_at AS createdAt, merged_at AS resolvedAt
         FROM pulls WHERE repo_full_name = ?`,
      )
      .all(repo) as Array<{ login: string | null; merged: number; state: string; createdAt: string | null; resolvedAt: string | null }>;
    items = rows.map((r) => ({
      login: r.login,
      resolved: r.merged === 1,
      rejected: r.merged !== 1 && r.state === 'closed',
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    }));
  }

  interface Acc { login: string; ttms: number[]; rejected: number }
  const byAuthor = new Map<string, Acc>();
  const pooled: number[] = []; // every counted resolve-time → repo baseline

  for (const it of items) {
    const lc = (it.login ?? '').toLowerCase();
    if (!lc || !isMiner(lc) || isMaintainer(lc)) continue;
    let a = byAuthor.get(lc);
    if (!a) { a = { login: it.login as string, ttms: [], rejected: 0 }; byAuthor.set(lc, a); }
    if (it.resolved) {
      const resolved = parseMs(it.resolvedAt);
      const created = parseMs(it.createdAt);
      if (Number.isFinite(resolved) && Number.isFinite(created)) {
        const hours = Math.max(0, (resolved - created) / HOUR_MS);
        a.ttms.push(hours);
        pooled.push(hours);
      }
    } else if (it.rejected) {
      a.rejected++;
    }
  }

  const repoMedianTtmHours = median(pooled);
  const miners: MinerFairnessRow[] = [];
  for (const a of byAuthor.values()) {
    if (a.ttms.length === 0) continue; // need ≥1 resolved item with a time
    const medianTtmHours = median(a.ttms) as number;
    miners.push({
      login: a.login,
      resolved: a.ttms.length,
      rejected: a.rejected,
      rejectRate: ratio(a.rejected, a.ttms.length + a.rejected),
      medianTtmHours,
      deltaVsRepoMedian: repoMedianTtmHours != null && repoMedianTtmHours > 0
        ? (repoMedianTtmHours - medianTtmHours) / repoMedianTtmHours
        : null,
      fasterThanRepo: repoMedianTtmHours != null && medianTtmHours < repoMedianTtmHours,
    });
  }
  miners.sort((x, y) => x.medianTtmHours - y.medianTtmHours); // fastest first

  return {
    repo,
    mode,
    repoMedianTtmHours,
    resolvedSample: pooled.length,
    minerCount: miners.length,
    minerFiltered: minerLogins != null,
    maintainersExcluded: maintainerLogins ? maintainerLogins.size : 0,
    maintainerFiltered: maintainerLogins != null,
    miners,
  };
}
