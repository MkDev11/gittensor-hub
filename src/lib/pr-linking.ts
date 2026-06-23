import type { Pull } from '@/types/entities';

// Closing-keyword (close[sd]/fix(e[sd])/resolve[sd]) followed by an issue/PR
// reference in any spelling GitHub accepts:
//   #123
//   owner/repo#123
//   https://github.com/owner/repo/issues/123   (the form GitHub's UI emits when
//   https://github.com/owner/repo/pull/123       you paste an issue/PR link)
// Two alternatives, so capture groups split by spelling:
//   m[1]/m[2] — repo + number from the full-URL `/issues|pull/<n>` form
//   m[3]/m[4] — optional repo + number from the bare `#<n>` / `owner/repo#<n>` form
// This matches the timeline route's ISSUE_MENTION_REGEX, which already handled
// the URL form; the closing-link extractor must agree so `pr_issue_links`
// (Completed bucketing, timeline will_close, related PRs) stays consistent.
const LINK_REGEX =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*(?:https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)|(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+)?#(\d+))/gi;

export interface LinkedIssueRef {
  repo: string | null;
  number: number;
}

export function extractLinkedIssues(pr: { body: string | null; title: string; repo_full_name: string }): LinkedIssueRef[] {
  const text = `${pr.title}\n${pr.body ?? ''}`;
  const out: LinkedIssueRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(LINK_REGEX)) {
    // Repo + number come from whichever alternative matched: the URL-path form
    // (groups 1/2) or the bare/`owner/repo#` form (groups 3/4). A bare `#<n>`
    // leaves the repo group undefined and falls back to the PR's own repo.
    const repo = m[1] ?? m[3] ?? pr.repo_full_name;
    const num = parseInt(m[2] ?? m[4], 10);
    if (!Number.isFinite(num)) continue;
    const key = `${repo}#${num}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ repo, number: num });
  }
  return out;
}

export function findRelatedPulls(
  pulls: Pull[],
  issue: { number: number; repo_full_name: string }
): Pull[] {
  return pulls.filter((pr) => {
    if (pr.repo_full_name !== issue.repo_full_name) return false;
    const links = extractLinkedIssues(pr);
    return links.some((l) => l.number === issue.number && (l.repo === null || l.repo === issue.repo_full_name));
  });
}
