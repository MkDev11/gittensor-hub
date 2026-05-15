export interface RepoEntry {
  fullName: string;
  owner: string;
  name: string;
  weight: number;
  /**
   * SN74's authoritative "this repo is inactive" timestamp. Set by the
   * Gittensor validator team in master_repositories.json when a repo is
   * deprioritised — miners earn no rewards from inactive repos. Absent on
   * active repos.
   */
  inactiveAt: string | null;
}

/**
 * Empty by design — the bundled `master_repositories.json` is no longer
 * consulted. Live data flows from `/api/sn74-repos` (server-side) into
 * client components via `useSn74Repos()`. Anything that imported this for
 * a synchronous initial value now just gets an empty list until the live
 * fetch lands; render an empty/loading state accordingly.
 */
export const ALL_REPOS: RepoEntry[] = [];

export function weightBand(weight: number): {
  label: string;
  tone: 'success' | 'accent' | 'attention' | 'severe' | 'neutral';
} {
  if (weight >= 0.5) return { label: 'Flagship', tone: 'success' };
  if (weight >= 0.3) return { label: 'High', tone: 'accent' };
  if (weight >= 0.15) return { label: 'Mid-High', tone: 'attention' };
  if (weight >= 0.05) return { label: 'Standard', tone: 'neutral' };
  return { label: 'Low', tone: 'severe' };
}
