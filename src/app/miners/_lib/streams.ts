// Reward-stream presentation — colors and the view/repo → stream mappings shared
// by the treemap (Headline) and the command palette (Palette), so the two never
// drift. Classification itself lives in miners.ts (repoEarnsPr /
// repoEarnsIssueDiscovery); this module only turns it into colors/labels.

import type { CSSProperties } from 'react';
import { repoEarnsIssueDiscovery, repoEarnsPr, type MinerView, type RepoSignal } from './miners';

// green = PRs/contributor pool, purple = issue discovery, orange = maintainer
// cut, gray = no identified (attributable) stream.
export const PR_COLOR = 'var(--success-emphasis)';
export const ISSUE_COLOR = 'var(--done-emphasis)';
export const MAINTAINER_COLOR = '#e0773d'; // orange — distinct from PR/issue
export const NEUTRAL_COLOR = 'var(--fg-subtle)'; // gray — earns/active but no attributable stream

export interface Streams {
  pr: boolean;
  issue: boolean;
  maintainer: boolean;
}

/** A miner's REAL earned streams. One with none — a non-earner, or the
 * divergence case (e.g. a maintainer cut the live roster no longer attributes to
 * them) — gets a neutral swatch downstream, not a misleading green/PR one. */
export function streamsOf(view: MinerView): Streams {
  return { pr: view.prEarning, issue: view.issueEarning, maintainer: view.isMaintainer };
}

/** Every reward-stream color a miner reads as, in display order: green (PR),
 * purple (issue discovery), orange (maintainer cut); neutral gray if none. */
export function streamColors(view: MinerView): string[] {
  const { pr, issue, maintainer } = streamsOf(view);
  const colors: string[] = [];
  if (pr) colors.push(PR_COLOR);
  if (issue) colors.push(ISSUE_COLOR);
  if (maintainer) colors.push(MAINTAINER_COLOR);
  return colors.length > 0 ? colors : [NEUTRAL_COLOR];
}

/** Single representative color — the miner's primary stream — for a tile tint. */
export function streamColor(view: MinerView): string {
  return streamColors(view)[0];
}

/** UID-pill background: a hard-stop split combining EVERY stream the miner has
 * (e.g. green | purple | orange for a PR + issue + maintainer contributor). */
export function streamBackground(view: MinerView): string {
  const colors = streamColors(view);
  if (colors.length === 1) return colors[0];
  const seg = 100 / colors.length;
  const stops = colors.map((c, i) => `${c} ${(i * seg).toFixed(1)}% ${((i + 1) * seg).toFixed(1)}%`).join(', ');
  return `linear-gradient(90deg, ${stops})`;
}

export function streamLabel(view: MinerView): string {
  const { pr, issue, maintainer } = streamsOf(view);
  const parts: string[] = [];
  if (pr) parts.push('Pull requests');
  if (issue) parts.push('Issue discovery');
  if (maintainer) parts.push('Maintainer cut');
  return parts.join(' + ') || 'No identified reward stream';
}

/** Tinted "filled" badge style in a stream color — used for the top-repo chips. */
export function fillBadge(color: string): CSSProperties {
  return {
    background: `color-mix(in srgb, ${color} 16%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
    color,
  };
}

/** How a miner earns on a specific repo → its chip color. A miner can't be both
 * a maintainer AND an eligible contributor on the SAME repo (gittensor
 * mechanism), so a maintained repo is unambiguously the maintainer-cut stream —
 * check it first; otherwise use the eligibility-gated reward predicates. */
export function repoStreamColor(row: RepoSignal, maintainerRepos: string[]): string {
  if (maintainerRepos.some((repo) => repo.toLowerCase() === row.repo.toLowerCase())) return MAINTAINER_COLOR;
  if (repoEarnsPr(row)) return PR_COLOR;
  if (repoEarnsIssueDiscovery(row)) return ISSUE_COLOR;
  return PR_COLOR;
}
