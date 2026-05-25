import type { Pull } from '@/types/entities';

// GitHub only treats close/fix/resolve as a *closing* keyword when it stands
// as its own word right before the reference — `bugfix #42`, `hotfix #1234`,
// `prefix #7`, `unresolved #5`, `discloses #3` are NOT links. The leading
// `(?<=^|[^\w])` lookbehind enforces that boundary without consuming a
// character; a consuming `(?:^|[^\w])` prefix would eat the separator and can
// break adjacent matches under `matchAll`.
const LINK_REGEX =
  /(?<=^|[^\w])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*(?:(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+))?#(\d+)/gi;
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*(?:(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+))?#(\d+)/gi;

export interface LinkedIssueRef {
  repo: string | null;
  number: number;
}

export function extractLinkedIssues(pr: { body: string | null; title: string; repo_full_name: string }): LinkedIssueRef[] {
  const text = `${pr.title}\n${pr.body ?? ''}`;
  const out: LinkedIssueRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(LINK_REGEX)) {
    const repo = m[1] || pr.repo_full_name;
    const num = parseInt(m[2], 10);
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
