/* Bulk repo metadata fetched from GitHub.
 *
 * The `/api/sn74-repos` mirror only carries the SN74 *policy* (emission
 * share, label multipliers, eligibility, etc.) — it has no description,
 * topics, or language breakdown. The `/repositories` page needs both for
 * its card / list / drawer surfaces, so this route fans out to the GitHub
 * REST API once for every SN74 repo and caches the result in-memory for an
 * hour (descriptions and language ratios change rarely).
 *
 * Output shape: `{ [fullName]: { description, langs: [[name, pct], …] } }`. */

import { NextResponse } from 'next/server';
import { withRotation } from '@/lib/github';
import { getLiveReposAsyncServer } from '@/lib/repos-server';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — metadata churn is slow
const PER_REPO_TIMEOUT_MS = 30_000;  // per-repo cap; covers up to ~10 sequential search pages + one rate-limit cooldown without falling back to stale cache
const CONCURRENCY = 4;               // GitHub secondary rate limits punish bursts; throttle ourselves
/** How long to wait before re-trying a repo that came back without langs.
 *  Independent of CACHE_TTL_MS — a transient 5xx shouldn't sentence a repo
 *  to an hour of `—` in the UI. */
const EMPTY_LANGS_RETRY_MS = 60_000;
/** Per-call retry budget for transient errors (5xx / network) inside a
 *  single refresh. Rate-limit handling already lives in withRotation. */
const SUBCALL_RETRIES = 2;
const SUBCALL_BACKOFF_MS = 600;

export interface RepoMeta {
  description: string;
  /** Languages sorted descending by byte share, expressed as percentages. */
  langs: Array<[string, number]>;
  /** Live open pull request count from GitHub. -1 when the fetch failed. */
  openPrCount: number;
  /** Daily count of GitHub issues opened on the repo over the last 30
   *  days (oldest first, length 30). Index 0 = 29 days ago, 29 = today.
   *  Powers the Contributions chart's lower (issue) half. Empty array
   *  when the issues fetch failed. */
  dailyIssues30d: number[];
}

interface CacheEntry {
  fetchedAt: number;
  data: Record<string, RepoMeta>;
}

let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry> | null = null;

function emptyMeta(): RepoMeta {
  return {
    description: '',
    langs: [],
    openPrCount: -1,
    dailyIssues30d: new Array(30).fill(0),
  };
}

/** Run an async task list with bounded concurrency. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (err) {
        results[i] = { status: 'rejected', reason: err };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** Count open PRs via Link-header pagination — call with per_page=1 and the
 *  "last" page number IS the total count. One API call, no full pagination. */
function parseLastPage(linkHeader: string | undefined): number | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  return match ? parseInt(match[1], 10) : null;
}

/** Search-API fetch of issues *created* in the last 30 days. Uses
 *  `is:issue created:>=DATE` so PRs are filtered server-side — the older
 *  `issues.listForRepo` path returned issues+PRs combined and the
 *  per_page=100 cap was being exhausted by PRs on active repos
 *  (e.g. on ragflow we'd see ~29 of 240 real issues). Search is capped
 *  at 100/page and 1000 total — paginate up to 10 pages. Uses the
 *  search-quota lane in withRotation (30/min per PAT). */
async function fetchIssueCreates30d(
  owner: string,
  name: string,
  thirtyDaysAgoIso: string,
): Promise<{ items: Array<{ created_at?: string }>; totalCount: number; hardCapped: boolean; incomplete: boolean }> {
  const q = `repo:${owner}/${name} is:issue created:>=${thirtyDaysAgoIso}`;
  const items: Array<{ created_at?: string }> = [];
  let totalCount = 0;
  let hardCapped = false;
  let incomplete = false;
  for (let page = 1; page <= 10; page++) {
    const resp = await withRotation(
      (o) =>
        o.request('GET /search/issues', {
          q,
          sort: 'created',
          order: 'desc',
          per_page: 100,
          page,
        }),
      { kind: 'search' },
    );
    totalCount = resp.data.total_count;
    if (resp.data.incomplete_results) incomplete = true;
    const batch = resp.data.items as Array<{ created_at?: string }>;
    items.push(...batch);
    if (batch.length < 100) break;
    if (items.length >= totalCount) break;
    if (page === 10 && items.length < totalCount) hardCapped = true;
  }
  return { items, totalCount, hardCapped, incomplete };
}

/** Retry a sub-call on transient errors (5xx / network). 404s and auth
 *  errors bubble immediately — no point retrying those. Rate-limit
 *  rotation already happens inside withRotation. */
async function retrySubcall<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= SUBCALL_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      // 404, 401, 403 (after rotation exhaustion) — terminal, don't retry.
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        throw err;
      }
      if (attempt < SUBCALL_RETRIES) {
        await new Promise((r) => setTimeout(r, SUBCALL_BACKOFF_MS * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

/** Track per-repo when we last attempted a fill. Stops the empty-langs
 *  retry from hammering GitHub when a repo genuinely has no langs (e.g.
 *  docs-only repo) — we wait EMPTY_LANGS_RETRY_MS between retries. */
const lastAttemptAt = new Map<string, number>();

/** Per-repo "search issues succeeded since process start". Lets the
 *  partial-refresh helper distinguish "fetched and genuinely empty"
 *  (legit quiet repo) from "fetch failed → seeded with zeros" (needs
 *  retry). Without this, the empty-array sentinel is indistinguishable
 *  from a real empty result and we can't safely re-fetch. */
const issuesFetched = new Set<string>();

async function refresh(): Promise<CacheEntry> {
  const { repos } = await getLiveReposAsyncServer();
  // Seed from the previous cache so a repo that fails *this* refresh keeps
  // its last-known langs/description/openPrCount instead of disappearing
  // for an hour. Per-field fallbacks below also merge with this so partial
  // failures (e.g. pulls.list 403 but listLanguages 200) don't wipe out
  // good fields that were just refreshed.
  const map: Record<string, RepoMeta> = { ...(cache?.data ?? {}) };
  console.warn(`[repos/metadata] refresh begin — ${repos.length} repos`);
  const t0 = Date.now();

  // Per-field counters so the log line tells us *which* call is failing —
  // helpful when GitHub rate-limits one endpoint but not others.
  let okRepo = 0, okLang = 0, okPulls = 0, okIssues = 0;
  let failRepo = 0, failLang = 0, failPulls = 0, failIssues = 0;
  let timedOutRepos = 0;

  // Day-bin helpers shared by every per-repo issues binning below.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const thirtyDaysAgoIso = new Date(now - 30 * DAY_MS).toISOString();

  const results = await mapPool(repos, CONCURRENCY, async (r) => {
    const [owner, name] = r.fullName.split('/');
    if (!owner || !name) return null;
    const key = r.fullName.toLowerCase();
    const prior = cache?.data[key];

    // allSettled per sub-call so one rate-limit doesn't drop the whole
    // repo. Each field independently falls back to the prior cached value
    // when its specific call fails. Each call also has a small retry
    // budget for transient 5xx / network hiccups (rate-limit rotation
    // already happens inside withRotation).
    lastAttemptAt.set(key, Date.now());
    const [repoResult, langResult, pullsResult, issuesResult] = await withTimeout(
      Promise.allSettled([
        retrySubcall(() => withRotation((o) => o.repos.get({ owner, repo: name }))),
        retrySubcall(() => withRotation((o) => o.repos.listLanguages({ owner, repo: name }))),
        retrySubcall(() =>
          withRotation((o) => o.pulls.list({ owner, repo: name, state: 'open', per_page: 1 })),
        ),
        // 30-day issue history via the search API. `is:issue` filters
        // PRs server-side so the per-page budget isn't burned on PRs
        // (the older `issues.listForRepo` path returned both combined
        // and the 100-row cap was exhausted by PRs on any active repo).
        // See `fetchIssueCreates30d` for the pagination + 1000-row
        // hard cap handling.
        retrySubcall(() => fetchIssueCreates30d(owner, name, thirtyDaysAgoIso)),
      ]),
      PER_REPO_TIMEOUT_MS,
      `repos/metadata ${r.fullName}`,
    );

    let description = prior?.description ?? '';
    if (repoResult.status === 'fulfilled') {
      description = repoResult.value.data.description ?? '';
      okRepo++;
    } else {
      failRepo++;
      console.warn(`[repos/metadata] ${r.fullName} repos.get failed:`, errMsg(repoResult.reason));
    }

    let langs: Array<[string, number]> = prior?.langs ?? [];
    if (langResult.status === 'fulfilled') {
      const langEntries = Object.entries(langResult.value.data) as Array<[string, number]>;
      const total = langEntries.reduce((s, [, v]) => s + (v || 0), 0) || 1;
      langs = langEntries
        .map(([n, bytes]) => [n, (bytes / total) * 100] as [string, number])
        .sort((a, b) => b[1] - a[1]);
      okLang++;
    } else {
      failLang++;
      console.warn(`[repos/metadata] ${r.fullName} listLanguages failed:`, errMsg(langResult.reason));
    }

    let openPrCount = prior?.openPrCount ?? -1;
    if (pullsResult.status === 'fulfilled') {
      const linkHeader = pullsResult.value.headers?.link as string | undefined;
      const lastPage = parseLastPage(linkHeader);
      openPrCount = lastPage ?? pullsResult.value.data.length;
      okPulls++;
    } else {
      failPulls++;
      console.warn(`[repos/metadata] ${r.fullName} pulls.list failed:`, errMsg(pullsResult.reason));
    }

    // Issue-creation sparkline. Search API has already filtered PRs and
    // already filtered by created_at server-side; bin by date into a
    // 30-day oldest-first array. The bin filter still drops anything
    // outside the window as a safety net against day-boundary drift.
    let dailyIssues30d: number[] = prior?.dailyIssues30d ?? new Array(30).fill(0);
    if (issuesResult.status === 'fulfilled') {
      const { items, totalCount, hardCapped, incomplete } = issuesResult.value;
      if (hardCapped) {
        console.warn(`[repos/metadata] ${r.fullName} search hit 1000-row hard cap (total_count=${totalCount}) — extreme outlier`);
      }
      if (incomplete) {
        console.warn(`[repos/metadata] ${r.fullName} search returned incomplete_results — bins may undercount until GitHub re-indexes`);
      }
      const bins = new Array<number>(30).fill(0);
      for (const it of items) {
        if (!it.created_at) continue;
        const t = Date.parse(it.created_at);
        if (!Number.isFinite(t) || t <= 0) continue;
        const dayStart = Math.floor(t / DAY_MS) * DAY_MS;
        const daysAgo = Math.floor((todayStart - dayStart) / DAY_MS);
        if (daysAgo < 0 || daysAgo >= 30) continue;
        bins[29 - daysAgo] += 1;
      }
      dailyIssues30d = bins;
      issuesFetched.add(key);
      okIssues++;
    } else {
      failIssues++;
      console.warn(`[repos/metadata] ${r.fullName} search issues failed:`, errMsg(issuesResult.reason));
    }

    return [r.fullName, { description, langs, openPrCount, dailyIssues30d }] as const;
  });

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      const [fullName, meta] = result.value;
      map[fullName.toLowerCase()] = meta;
    } else if (result.status === 'rejected') {
      // Only path here is withTimeout firing (the per-sub-call rejections
      // are already swallowed by allSettled). Prior cache entry, if any,
      // is preserved via the initial map spread.
      timedOutRepos++;
      console.warn('[repos/metadata] per-repo timeout:', errMsg(result.reason));
    }
  }
  console.warn(
    `[repos/metadata] refresh done in ${Date.now() - t0}ms — ` +
      `repos ${results.length - timedOutRepos}/${repos.length} (${timedOutRepos} timed out) · ` +
      `repo ${okRepo}/${okRepo + failRepo} · langs ${okLang}/${okLang + failLang} · ` +
      `pulls ${okPulls}/${okPulls + failPulls} · issues ${okIssues}/${okIssues + failIssues}`,
  );

  const entry: CacheEntry = { fetchedAt: Date.now(), data: map };
  cache = entry;
  return entry;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Re-fetch just the per-repo sub-calls that came back empty / failed
 *  on the last attempt — covers transient 5xx / rate-limit cases
 *  without forcing a full hourly refresh. Throttled by `lastAttemptAt`
 *  per repo. Now handles both `langs` (empty array sentinel) and
 *  `issues` (never-fetched-since-startup sentinel via `issuesFetched`). */
let partialInflight: Promise<void> | null = null;
async function refreshMissing(): Promise<void> {
  if (partialInflight) return partialInflight;
  if (!cache) return;
  const { repos } = await getLiveReposAsyncServer();
  const now = Date.now();
  const stale = repos
    .map((r) => {
      const key = r.fullName.toLowerCase();
      const entry = cache?.data[key];
      const needsLangs = !entry || entry.langs.length === 0;
      const needsIssues = !issuesFetched.has(key);
      if (!needsLangs && !needsIssues) return null;
      const last = lastAttemptAt.get(key) ?? 0;
      if (now - last < EMPTY_LANGS_RETRY_MS) return null;
      return { r, key, needsLangs, needsIssues };
    })
    .filter((x): x is { r: typeof repos[number]; key: string; needsLangs: boolean; needsIssues: boolean } => x !== null);
  if (stale.length === 0) return;
  partialInflight = (async () => {
    console.warn(`[repos/metadata] partial refresh — ${stale.length} repo(s) (langs/issues backfill)`);
    const results = await mapPool(stale, CONCURRENCY, async ({ r, key, needsLangs, needsIssues }) => {
      const [owner, name] = r.fullName.split('/');
      if (!owner || !name) return null;
      lastAttemptAt.set(key, Date.now());

      // Run only the sub-calls this repo actually needs. allSettled so a
      // langs failure doesn't block issues backfill (or vice-versa).
      const tasks: Array<Promise<unknown>> = [];
      if (needsLangs) {
        tasks.push(
          retrySubcall(() => withRotation((o) => o.repos.listLanguages({ owner, repo: name }))),
        );
      } else {
        tasks.push(Promise.resolve(null));
      }
      if (needsIssues) {
        const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        tasks.push(retrySubcall(() => fetchIssueCreates30d(owner, name, thirtyDaysAgoIso)));
      } else {
        tasks.push(Promise.resolve(null));
      }
      const [langRes, issuesRes] = await withTimeout(Promise.allSettled(tasks), PER_REPO_TIMEOUT_MS, `repos/metadata partial ${r.fullName}`);

      let langs: Array<[string, number]> | null = null;
      if (needsLangs && langRes.status === 'fulfilled' && langRes.value) {
        // Same shape as the main-refresh listLanguages handler.
        const data = (langRes.value as { data: Record<string, number> }).data;
        const langEntries = Object.entries(data) as Array<[string, number]>;
        const total = langEntries.reduce((s, [, v]) => s + (v || 0), 0) || 1;
        langs = langEntries
          .map(([n, bytes]) => [n, (bytes / total) * 100] as [string, number])
          .sort((a, b) => b[1] - a[1]);
      } else if (needsLangs) {
        console.warn(`[repos/metadata] partial ${r.fullName} langs failed:`, errMsg(langRes.status === 'rejected' ? langRes.reason : 'unexpected'));
      }

      let issueBins: number[] | null = null;
      if (needsIssues && issuesRes.status === 'fulfilled' && issuesRes.value) {
        const DAY_MS = 24 * 60 * 60 * 1000;
        const todayStart = Math.floor(Date.now() / DAY_MS) * DAY_MS;
        const bins = new Array<number>(30).fill(0);
        const { items } = issuesRes.value as { items: Array<{ created_at?: string }> };
        for (const it of items) {
          if (!it.created_at) continue;
          const t = Date.parse(it.created_at);
          if (!Number.isFinite(t) || t <= 0) continue;
          const dayStart = Math.floor(t / DAY_MS) * DAY_MS;
          const daysAgo = Math.floor((todayStart - dayStart) / DAY_MS);
          if (daysAgo < 0 || daysAgo >= 30) continue;
          bins[29 - daysAgo] += 1;
        }
        issueBins = bins;
      } else if (needsIssues) {
        console.warn(`[repos/metadata] partial ${r.fullName} issues failed:`, errMsg(issuesRes.status === 'rejected' ? issuesRes.reason : 'unexpected'));
      }

      return { key, fullName: r.fullName, langs, issueBins };
    });

    let langsRecovered = 0;
    let issuesRecovered = 0;
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const { key, langs, issueBins } = result.value;
      const entry = cache?.data[key];
      if (!entry) continue;
      if (langs && langs.length > 0) {
        entry.langs = langs;
        langsRecovered++;
      }
      if (issueBins) {
        entry.dailyIssues30d = issueBins;
        issuesFetched.add(key);
        issuesRecovered++;
      }
    }
    console.warn(`[repos/metadata] partial refresh recovered langs ${langsRecovered}, issues ${issuesRecovered} / ${stale.length}`);
  })().finally(() => {
    partialInflight = null;
  });
  return partialInflight;
}

async function getCached(): Promise<CacheEntry> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    // Fire-and-forget: opportunistically backfill any repos still missing
    // langs. Doesn't block this response — next refetch picks up the
    // recovered entries. Throttled per-repo so it can't burst-call.
    void refreshMissing();
    return cache;
  }
  if (cache) {
    if (!inflight) {
      console.warn(`[repos/metadata] serving stale cache while refresh runs — age=${now - cache.fetchedAt}ms`);
      inflight = refresh().finally(() => {
        inflight = null;
      });
    }
    void refreshMissing();
    return cache;
  }
  if (inflight) return inflight;
  const { repos } = await getLiveReposAsyncServer();
  const seeded: Record<string, RepoMeta> = {};
  for (const repo of repos) seeded[repo.fullName.toLowerCase()] = emptyMeta();
  cache = { fetchedAt: 0, data: seeded };
  console.warn(`[repos/metadata] serving cold fallback for ${repos.length} repo(s) while refresh runs`);
  inflight = refresh().finally(() => {
    inflight = null;
  });
  return cache;
}

export async function GET() {
  try {
    const entry = await getCached();
    return NextResponse.json({
      fetched_at: new Date(entry.fetchedAt).toISOString(),
      count: Object.keys(entry.data).length,
      repos: entry.data,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err), repos: {} }, { status: 502 });
  }
}
