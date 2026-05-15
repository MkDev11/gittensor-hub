import rawRepos from '@/data/master_repositories.json';

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

interface MasterRepoEntry {
  weight: number;
  inactive_at?: string | null;
}

function buildRepos(map: Record<string, MasterRepoEntry>): RepoEntry[] {
  return Object.entries(map)
    .map(([fullName, entry]) => {
      const [owner, name] = fullName.split('/');
      return {
        fullName,
        owner,
        name,
        weight: entry.weight,
        inactiveAt: entry.inactive_at ?? null,
      };
    })
    .sort((a, b) => b.weight - a.weight);
}

const bundledMap = rawRepos as Record<string, MasterRepoEntry>;

/**
 * Bundled snapshot of master_repositories.json baked in at build time. Used
 * as the synchronous fallback before the live fetch resolves and whenever
 * GitHub is unreachable. Most callers should prefer `getLiveRepos()` which
 * returns this on cold start and switches to the live source thereafter.
 */
export const ALL_REPOS: RepoEntry[] = buildRepos(bundledMap);

// Client-safe accessor: returns just the bundled snapshot. Server-side code
// that wants the bundled-plus-discovered merge should import
// `getLiveReposServer` / `getLiveReposAsyncServer` from `repos-server.ts`.
export function getLiveRepos(): RepoEntry[] {
  return ALL_REPOS;
}

export async function getLiveReposAsync(): Promise<{
  repos: RepoEntry[];
  source: 'live' | 'bundled';
  fetchedAt: number;
}> {
  return { repos: ALL_REPOS, source: 'bundled', fetchedAt: 0 };
}

export function isRepoInactive(repo: RepoEntry | { inactiveAt: string | null }): boolean {
  return repo.inactiveAt != null;
}

export const REPO_COUNT = ALL_REPOS.length;

export function getRepo(fullName: string): RepoEntry | undefined {
  return getLiveRepos().find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
}

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
