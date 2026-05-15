import { getLiveRepos } from '@/lib/repos';
import type { IssueDto } from '@/lib/api-types';

/**
 * Look up a repo's SN74 weight from the live master_repositories.json
 * cache. Building the map per-call (rather than at module-load) means
 * upstream additions like `entrius/das-github-mirror` start counting as
 * whitelisted as soon as the live cache refreshes — the old module-load
 * snapshot would have stayed wrong until the next deploy.
 */
function repoWeight(fullName: string): number | undefined {
  const key = fullName.toLowerCase();
  for (const r of getLiveRepos()) {
    if (r.fullName.toLowerCase() === key) return r.weight;
  }
  return undefined;
}

export type DeterministicVerdict = 'valid' | 'invalid' | 'unknown';

export interface DeterministicCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'na';
  detail: string;
}

export interface DeterministicResult {
  verdict: DeterministicVerdict;
  earnsLinkedIssueBonus: boolean | null;
  predictedMultiplier: 1.0 | 1.33 | 1.66;
  checks: DeterministicCheck[];
}

const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const BASE_PR_SCORE = 25;
const STANDARD_ISSUE_MULTIPLIER = 1.33;
const MAINTAINER_ISSUE_MULTIPLIER = 1.66;

const LABEL_MULTIPLIERS: Record<string, number> = {
  feature: 1.5,
  enhancement: 1.25,
  bug: 1.25,
  fix: 1.25,
  performance: 1.25,
  perf: 1.25,
  documentation: 0.75,
  docs: 0.75,
  test: 0.75,
  refactor: 0.5,
  chore: 0.5,
};

export interface ScorePrediction {
  predicted: number;
  best: number;
  worst: number;
  breakdown: Array<{ factor: string; value: number; note: string }>;
  formula: string;
}

export function predictScore(issue: IssueDto): ScorePrediction {
  const weight = repoWeight(issue.repo_full_name) ?? 0;
  const breakdown: ScorePrediction['breakdown'] = [];

  if (weight === 0) {
    return {
      predicted: 0,
      best: 0,
      worst: 0,
      breakdown: [{ factor: 'Repo weight', value: 0, note: 'Not in SN74 whitelist — fixing this issue earns 0 TAO.' }],
      formula: '0 (not whitelisted)',
    };
  }

  if (issue.state === 'closed') {
    return {
      predicted: 0,
      best: 0,
      worst: 0,
      breakdown: [
        { factor: 'Issue state', value: 0, note: `Issue already closed (${issue.state_reason ?? 'unknown'}) — cannot earn rewards.` },
      ],
      formula: '0 (issue already closed)',
    };
  }

  breakdown.push({ factor: 'Base PR score', value: BASE_PR_SCORE, note: 'Constant. Awarded when PR token_score ≥ 5.' });
  breakdown.push({ factor: 'Repo weight', value: weight, note: `${issue.repo_full_name} weight from master_repositories.json` });

  const isMaintainer = MAINTAINER_ASSOCIATIONS.has(issue.author_association ?? 'NONE');
  const issueMultiplier = isMaintainer ? MAINTAINER_ISSUE_MULTIPLIER : STANDARD_ISSUE_MULTIPLIER;
  breakdown.push({
    factor: 'Issue multiplier',
    value: issueMultiplier,
    note: isMaintainer
      ? `Author is a ${(issue.author_association ?? '').toLowerCase()} — earns 1.66x maintainer bonus.`
      : 'Author is not a repo maintainer — earns 1.33x standard bonus.',
  });

  const labelNames = (issue.labels ?? []).map((l) => l.name.toLowerCase());
  let labelMult = 1.0;
  let labelHit = '';
  for (const tag of labelNames) {
    for (const [key, val] of Object.entries(LABEL_MULTIPLIERS)) {
      if (tag.includes(key)) {
        if (val > labelMult) {
          labelMult = val;
          labelHit = key;
        }
      }
    }
  }
  if (labelMult !== 1.0) {
    breakdown.push({
      factor: 'PR label hint',
      value: labelMult,
      note: `Issue label "${labelHit}" suggests the solving PR will earn ${labelMult.toFixed(2)}x. Actual depends on PR labels.`,
    });
  }

  const predicted = BASE_PR_SCORE * weight * issueMultiplier * labelMult;
  const best = BASE_PR_SCORE * weight * MAINTAINER_ISSUE_MULTIPLIER * 1.5;
  const worst = BASE_PR_SCORE * weight * 1.0 * 0.5;

  return {
    predicted,
    best,
    worst,
    breakdown,
    formula: `${BASE_PR_SCORE} × ${weight.toFixed(4)} × ${issueMultiplier.toFixed(2)}${labelMult !== 1.0 ? ` × ${labelMult.toFixed(2)}` : ''} = ${predicted.toFixed(2)}`,
  };
}

export function runDeterministicChecks(issue: IssueDto): DeterministicResult {
  const checks: DeterministicCheck[] = [];

  const weight = repoWeight(issue.repo_full_name);
  if (weight === undefined) {
    checks.push({
      id: 'whitelist',
      label: 'Repo in SN74 whitelist',
      status: 'fail',
      detail: 'Not in master_repositories.json — PRs to this repo earn nothing on SN74.',
    });
  } else {
    checks.push({
      id: 'whitelist',
      label: 'Repo in SN74 whitelist',
      status: 'pass',
      detail: `Weight ${weight.toFixed(4)} (${weight >= 0.3 ? 'high tier' : weight >= 0.15 ? 'mid-high' : weight >= 0.05 ? 'standard' : 'low tier'}).`,
    });
  }

  if (!issue.author_login) {
    checks.push({
      id: 'author',
      label: 'Issue has identified author',
      status: 'fail',
      detail: 'Author login is missing — this issue cannot grant a PR-linkage bonus.',
    });
  } else {
    checks.push({
      id: 'author',
      label: 'Issue has identified author',
      status: 'pass',
      detail: `Authored by ${issue.author_login}.`,
    });
  }

  const assoc = issue.author_association ?? 'NONE';
  const isMaintainer = MAINTAINER_ASSOCIATIONS.has(assoc);
  checks.push({
    id: 'maintainer',
    label: 'Author is repo maintainer',
    status: isMaintainer ? 'pass' : 'warn',
    detail: isMaintainer
      ? `Author is a ${assoc.toLowerCase()} of the repo — solving PR earns the 1.66x maintainer bonus.`
      : `Author association is ${assoc.toLowerCase()} — solving PR earns standard 1.33x bonus, not 1.66x.`,
  });

  if (issue.state === 'open') {
    checks.push({
      id: 'state',
      label: 'Issue state is solvable',
      status: 'pass',
      detail: 'Issue is open — eligible to be solved by a future PR.',
    });
  } else {
    const reason = issue.state_reason ?? 'unknown';
    if (reason === 'COMPLETED' || reason === 'completed') {
      checks.push({
        id: 'state',
        label: 'Issue state is solvable',
        status: 'fail',
        detail: 'Issue is already closed as COMPLETED — someone already solved this.',
      });
    } else {
      checks.push({
        id: 'state',
        label: 'Issue state is solvable',
        status: 'fail',
        detail: `Issue is closed (state_reason=${reason}) — cannot earn rewards from solving.`,
      });
    }
  }

  if (issue.labels && issue.labels.length > 0) {
    const names = issue.labels.map((l) => l.name.toLowerCase());
    const flags = ['wontfix', 'invalid', 'duplicate', 'spam'];
    const matched = flags.filter((f) => names.some((n) => n.includes(f)));
    if (matched.length > 0) {
      checks.push({
        id: 'labels',
        label: 'No disqualifying labels',
        status: 'fail',
        detail: `Labels include "${matched.join(', ')}" — maintainers signaled this won't be merged.`,
      });
    } else {
      checks.push({
        id: 'labels',
        label: 'No disqualifying labels',
        status: 'pass',
        detail: `Labels: ${issue.labels
          .slice(0, 5)
          .map((l) => l.name)
          .join(', ')}${issue.labels.length > 5 ? '…' : ''}`,
      });
    }
  } else {
    checks.push({
      id: 'labels',
      label: 'No disqualifying labels',
      status: 'pass',
      detail: 'No labels.',
    });
  }

  const failed = checks.some((c) => c.status === 'fail');
  const verdict: DeterministicVerdict = failed ? 'invalid' : 'valid';
  const predictedMultiplier: 1.0 | 1.33 | 1.66 = failed ? 1.0 : isMaintainer ? 1.66 : 1.33;
  const earnsLinkedIssueBonus = failed ? false : true;

  return { verdict, earnsLinkedIssueBonus, predictedMultiplier, checks };
}
