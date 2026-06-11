// "Fairness signals" — per-miner merge-speed vs the repo's own baseline, to
// surface maintainers fast-tracking a favored set of accounts (a leading
// indicator of favoritism / sockpuppets / self-dealing) BEFORE a miner invests
// time contributing. Signals to investigate, not verdicts: a flagged miner is
// just an outlier vs this repo's own distribution.
//
// Per non-maintainer miner with ≥1 merged PR: median time-to-merge
// (mergedAt − createdAt), merged count, reject rate. Repo baseline = pooled
// median of every counted PR's TTM. A miner faster than that baseline is the
// "fast-tracked" highlight. Median (not mean) so one slow legit PR doesn't skew
// it. Maintainers are excluded from both the rows AND the baseline.
import Database from 'better-sqlite3';
import type { FairnessSignals, MinerFairnessRow } from './api-types';

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
  /** Lowercased registered miner logins — only their PRs are counted. */
  minerLogins: Set<string>;
  /** Lowercased maintainer logins — excluded from rows AND the baseline.
   *  Null when the mirror was unavailable (no exclusion applied). */
  maintainerLogins: Set<string> | null;
}

export function computeFairnessSignals(
  db: Database.Database,
  repo: string,
  opts: FairnessOptions,
): FairnessSignals {
  const { minerLogins, maintainerLogins } = opts;
  const isMaintainer = (lc: string): boolean => (maintainerLogins ? maintainerLogins.has(lc) : false);
  const parseMs = (iso: string | null): number => (iso ? Date.parse(iso) : NaN);

  const rows = db
    .prepare(
      `SELECT author_login AS login, merged, state, created_at AS createdAt, merged_at AS mergedAt
       FROM pulls WHERE repo_full_name = ?`,
    )
    .all(repo) as Array<{ login: string | null; merged: number; state: string; createdAt: string | null; mergedAt: string | null }>;

  interface Acc { login: string; ttms: number[]; rejected: number }
  const byAuthor = new Map<string, Acc>();
  const pooled: number[] = []; // every counted merged-PR TTM → repo baseline

  for (const p of rows) {
    const lc = (p.login ?? '').toLowerCase();
    if (!lc || !minerLogins.has(lc) || isMaintainer(lc)) continue;
    let a = byAuthor.get(lc);
    if (!a) { a = { login: p.login as string, ttms: [], rejected: 0 }; byAuthor.set(lc, a); }
    if (p.merged === 1) {
      const merged = parseMs(p.mergedAt);
      const created = parseMs(p.createdAt);
      if (Number.isFinite(merged) && Number.isFinite(created)) {
        const hours = Math.max(0, (merged - created) / HOUR_MS);
        a.ttms.push(hours);
        pooled.push(hours);
      }
    } else if (p.state === 'closed') {
      a.rejected++;
    }
  }

  const repoMedianTtmHours = median(pooled);
  const miners: MinerFairnessRow[] = [];
  for (const a of byAuthor.values()) {
    if (a.ttms.length === 0) continue; // need ≥1 merged PR with a TTM
    const medianTtmHours = median(a.ttms) as number;
    miners.push({
      login: a.login,
      mergedPrs: a.ttms.length,
      rejectedPrs: a.rejected,
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
    repoMedianTtmHours,
    mergedSample: pooled.length,
    minerCount: miners.length,
    maintainersExcluded: maintainerLogins ? maintainerLogins.size : 0,
    maintainerFiltered: maintainerLogins != null,
    miners,
  };
}
