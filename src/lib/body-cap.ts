// Single source of truth for how long issue/PR bodies are stored in the list
// cache. The poller (refresh.ts) caps bodies to these lengths to bound DB size
// across the thousands of rows it sweeps; detail opens fetch the full,
// uncapped body and persist it.
//
// Whether a stored body was actually shortened is tracked explicitly via the
// `body_truncated` flag on the `issues`/`pulls` rows — never inferred by
// comparing the stored length to one of these constants. That inference was
// fragile (issue #165): a body whose real length happened to equal the cap was
// misclassified as truncated forever, and the two sides could silently drift if
// only one cap changed. Keeping the caps here, and the truncation decision in
// `capBody`, means the poller and the detail routes can never disagree.
export const ISSUE_BODY_CAP = 8000;
export const PULL_BODY_CAP = 4000;

export interface CappedBody {
  /** The body clamped to at most `cap` characters. Never null. */
  body: string;
  /** 1 if the original body was longer than `cap` and got shortened, else 0. */
  truncated: 0 | 1;
}

/**
 * Cap a body to `cap` characters, reporting whether it was actually shortened.
 *
 * A body whose length is exactly `cap` is NOT truncated (`slice(0, cap)` of it
 * is the whole string) — the strict `>` is what fixes the exact-length
 * misclassification from issue #165.
 */
export function capBody(body: string | null | undefined, cap: number): CappedBody {
  const full = body ?? '';
  return { body: full.slice(0, cap), truncated: full.length > cap ? 1 : 0 };
}
