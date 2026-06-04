// Single source of truth for how a repo's issues are classified into the
// mutually-exclusive state buckets the dashboard shows. Both the repo-wide
// counts and every per-author aggregate build their `SUM(CASE ...)` columns
// from here so the dropdown badges, per-page author stats, author-column
// sorts, and the author-activity sidebar can never drift from the repo-wide
// `state_counts` (or from the `state=` filter the table itself uses).
//
// The buckets mirror the client-side `effectiveIssueState` rule, which mirrors
// Gittensor's solved-issue definition:
//
//   open        = state = 'open'
//   completed   = closed + reason='completed' AND >=1 MERGED linked PR
//   not_planned = closed + reason='not_planned'
//   duplicate   = closed + reason='duplicate'
//   closed      = everything else closed — including completed-without-a-
//                 merged-PR (the Gittensor "risky" bucket) — but NOT
//                 not_planned and NOT duplicate, which are their own buckets.
//
// Before this helper existed, the four per-author aggregates hand-wrote their
// `closed` CASE as merely `reason <> 'NOT_PLANNED'`, which silently folded
// DUPLICATE issues into `closed` (and omitted a per-author `duplicate` bucket
// entirely), so author badges/sorts disagreed with the repo-wide chips and the
// `state=closed` filter. Routing every query through `issueBucketSums` keeps
// the single `NOT IN ('NOT_PLANNED','DUPLICATE')` rule in one place.

export interface IssueBucketCounts {
  open: number;
  completed: number;
  not_planned: number;
  duplicate: number;
  closed: number;
}

/**
 * Build the `SUM(CASE ...) AS <prefix><bucket>` columns that classify issues
 * into the five state buckets.
 *
 * @param alias       The issues-table alias used in the surrounding query
 *                    (`i`, `s`, ...). Every reference is bound to it.
 * @param hasMergedPr A SQL boolean expression, evaluated per row, that is true
 *                    when the issue has at least one MERGED linked PR. Callers
 *                    pass either an EXISTS subquery bound to `alias` or a
 *                    precomputed-count expression (e.g. `COALESCE(mlc.cnt,0) > 0`).
 * @param colPrefix   Prepended to every output column name (e.g. `author_`).
 * @returns A comma-separated list of five `SUM(CASE ...)` columns, suitable for
 *          interpolation into a `SELECT`. Inputs are developer-controlled
 *          constants — never pass user input.
 */
export function issueBucketSums(alias: string, hasMergedPr: string, colPrefix = ''): string {
  const reason = `UPPER(COALESCE(${alias}.state_reason,''))`;
  return `SUM(CASE WHEN ${alias}.state = 'open' THEN 1 ELSE 0 END) AS ${colPrefix}open,
    SUM(CASE WHEN ${alias}.state = 'closed'
              AND ${reason} = 'COMPLETED'
              AND ${hasMergedPr}
        THEN 1 ELSE 0 END) AS ${colPrefix}completed,
    SUM(CASE WHEN ${alias}.state = 'closed'
              AND ${reason} = 'NOT_PLANNED'
        THEN 1 ELSE 0 END) AS ${colPrefix}not_planned,
    SUM(CASE WHEN ${alias}.state = 'closed'
              AND ${reason} = 'DUPLICATE'
        THEN 1 ELSE 0 END) AS ${colPrefix}duplicate,
    SUM(CASE WHEN ${alias}.state = 'closed'
              AND ${reason} NOT IN ('NOT_PLANNED','DUPLICATE')
              AND NOT (${reason} = 'COMPLETED' AND ${hasMergedPr})
        THEN 1 ELSE 0 END) AS ${colPrefix}closed`;
}

/** EXISTS subquery that is true when an issue (aliased `alias`) has at least
 *  one MERGED linked PR via `pr_issue_links`. Shared so every bucket query
 *  uses the identical merged-PR test. */
export function hasMergedLinkedPrSql(alias: string): string {
  return `EXISTS (SELECT 1 FROM pr_issue_links l
             JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
             WHERE l.repo_full_name = ${alias}.repo_full_name AND l.issue_number = ${alias}.number AND p.merged = 1)`;
}
