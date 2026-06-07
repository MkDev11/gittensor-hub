// Single source of truth for classifying a repo's pull requests into the four
// mutually-exclusive status buckets the dashboard shows. The list `state`
// filter, the `state_counts` aggregation, and the `sort=state` ordering all
// derive from here so they can never drift apart.
//
// The buckets follow `pullStatus()`'s precedence (merged → closed → draft →
// open): a PR is classified by the FIRST matching rule. A draft that was closed
// without ever merging counts as `closed` (it has state='closed'; users expect
// it under the Closed filter/count), NOT draft.
//
//   merged = merged = 1
//   closed = not merged AND state = 'closed'              (incl. closed drafts)
//   draft  = not merged AND state = 'open' AND draft = 1  (open drafts only)
//   open   = not merged AND state = 'open' AND draft = 0
//
// Because the predicates are disjoint and cover every PR (GitHub PR state is
// only 'open' or 'closed'), the four counts always sum to the total. Previously
// `closed` was `state = 'closed' AND merged = 0` while `draft` was
// `draft = 1 AND merged = 0`, so a closed unmerged draft matched BOTH — it was
// double-counted and inflated `state_counts`. Pinning every PR to exactly one
// bucket here, with `closed` taking precedence over `draft`, fixes that and
// keeps the badge / filter / counts in agreement.

export type PullBucket = 'open' | 'draft' | 'merged' | 'closed';

// Bucket display/iteration order — also the order `state_counts` emits columns.
export const PULL_BUCKETS: readonly PullBucket[] = ['open', 'draft', 'merged', 'closed'];

/**
 * SQL boolean predicate over the `pulls` columns (`state` / `draft` / `merged`)
 * that is true for exactly the rows in `bucket`. The predicates are mutually
 * exclusive. `alias` qualifies the columns (e.g. `'p'` → `p.merged`) for queries
 * that join/alias the `pulls` table; pass `''` (default) for unqualified columns.
 * Inputs are developer-controlled constants — never user input.
 */
export function pullBucketPredicate(bucket: PullBucket, alias = ''): string {
  const c = alias ? `${alias}.` : '';
  switch (bucket) {
    case 'merged':
      return `${c}merged = 1`;
    case 'closed':
      return `${c}merged = 0 AND ${c}state = 'closed'`;
    case 'draft':
      return `${c}merged = 0 AND ${c}state = 'open' AND ${c}draft = 1`;
    case 'open':
      return `${c}merged = 0 AND ${c}state = 'open' AND ${c}draft = 0`;
  }
}

/**
 * `SUM(CASE WHEN <predicate> THEN 1 ELSE 0 END) AS <bucket>` columns for all
 * four buckets, for the `state_counts` aggregation `SELECT`. `alias` qualifies
 * the source columns (see `pullBucketPredicate`).
 */
export function pullBucketSums(alias = ''): string {
  return PULL_BUCKETS.map(
    (b) => `SUM(CASE WHEN ${pullBucketPredicate(b, alias)} THEN 1 ELSE 0 END) AS ${b}`,
  ).join(',\n         ');
}

/**
 * `CASE … END` expression ranking rows by bucket precedence
 * (merged 0 → closed 1 → draft 2 → open 3) for `ORDER BY state`. Mirrors
 * `pullStatus()` so a closed draft sorts with Closed, matching its badge,
 * the filter, and the counts. `alias` qualifies the columns (see above).
 */
export function pullBucketRankSql(alias = ''): string {
  return `CASE
      WHEN ${pullBucketPredicate('merged', alias)} THEN 0
      WHEN ${pullBucketPredicate('closed', alias)} THEN 1
      WHEN ${pullBucketPredicate('draft', alias)} THEN 2
      ELSE 3 END`;
}
