/* A miner's complete works across all tracked repos — for the miner detail modal.
 *
 * Pull requests come from the gittensor `/prs` feed (the authoritative scored-PR
 * list, carrying author + repo + gittensor score); we cache the full mapped list
 * in-memory (30s) with in-flight dedup so per-miner opens never burst upstream, and
 * filter it by the requested login / githubId. Issues come from the local issues
 * mirror (the same table the explorer's /api/issues uses — NOT the users table),
 * queried by author. Both lists are capped. */

import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/db';
import { withRotation } from '@/lib/github';
import type { MinerActivityPoint, MinerIssue, MinerPr, MinerWorksResponse } from '@/types/entities';

export const dynamic = 'force-dynamic';

const PRS_URL = 'https://api.gittensor.io/prs';
const TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 15_000;
/** Per-list cap — the most prolific miner has ~500 works; 1000 returns the full set
 * (incl. closed PRs, which sort last and were being truncated) while staying bounded. */
const MAX = 1000;

interface UpstreamPr {
  pullRequestNumber: number;
  pullRequestTitle: string;
  repository: string;
  author?: string | null;
  githubId?: string | null;
  hotkey?: string | null;
  prCreatedAt: string;
  mergedAt: string | null;
  prState: string;
  additions?: number | null;
  deletions?: number | null;
  commitCount?: number | null;
  score?: string | number | null;
  baseScore?: string | number | null;
  collateralScore?: string | number | null;
  tokenScore?: string | number | null;
  totalNodesScored?: string | number | null;
  structuralCount?: string | number | null;
  structuralScore?: string | number | null;
  leafCount?: string | number | null;
  leafScore?: string | number | null;
  label?: string | null;
  labelMultiplier?: string | number | null;
  reviewQualityMultiplier?: string | number | null;
}

/** Internal PR row — the public `MinerPr` plus the keys we filter on. */
type IndexedPr = MinerPr & { authorLc: string; githubId: string };

interface PrCache {
  fetched_at: number;
  prs: IndexedPr[];
}

let prCache: PrCache | null = null;
let inFlight: Promise<PrCache> | null = null;

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

function deriveState(p: UpstreamPr): 'OPEN' | 'MERGED' | 'CLOSED' {
  if (p.mergedAt) return 'MERGED';
  if ((p.prState ?? '').toUpperCase() === 'CLOSED') return 'CLOSED';
  return 'OPEN';
}

function parseLinkedIssue(title: string): number | null {
  const m = (title ?? '').match(/^\s*#(\d+)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type GhLabel = { name: string; color?: string };

/** Pull GitHub labels (name + hex color) out of a stored JSON blob. Issues keep a
 * `labels` column holding the array directly; pulls only have `raw_json`, whose
 * `.labels` field carries them. Returns [] on any shape mismatch. */
function extractLabels(jsonStr: string | null, fromRawJson: boolean): GhLabel[] {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    const arr = fromRawJson ? (parsed as { labels?: unknown })?.labels : parsed;
    if (!Array.isArray(arr)) return [];
    const out: GhLabel[] = [];
    for (const l of arr) {
      if (l && typeof l === 'object' && 'name' in l) {
        const o = l as { name?: unknown; color?: unknown };
        if (typeof o.name === 'string' && o.name) {
          out.push({ name: o.name, color: typeof o.color === 'string' ? o.color : undefined });
        }
      }
      if (out.length >= 8) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Per-repo GitHub label → hex color, derived from the mirror (issues carry colors
 * directly; mirrored PRs carry them in raw_json). Cached per repo for the process —
 * label colors are effectively static. Lets us paint feed-sourced PR labels (which
 * arrive without a color) in their real GitHub color instead of a guessed fallback. */
const repoPaletteCache = new Map<string, Map<string, string>>();

function repoLabelColors(repoLc: string): Map<string, string> {
  const cached = repoPaletteCache.get(repoLc);
  if (cached) return cached;
  const m = new Map<string, string>();
  try {
    const db = getReadDb();
    const irows = db
      .prepare('SELECT labels FROM issues WHERE LOWER(repo_full_name) = ? AND labels IS NOT NULL LIMIT 800')
      .all(repoLc) as Array<{ labels: string }>;
    for (const r of irows) {
      for (const l of extractLabels(r.labels, false)) {
        const k = l.name.toLowerCase();
        if (l.color && !m.has(k)) m.set(k, l.color);
      }
    }
    const prows = db
      .prepare('SELECT raw_json FROM pulls WHERE LOWER(repo_full_name) = ? AND raw_json IS NOT NULL LIMIT 400')
      .all(repoLc) as Array<{ raw_json: string }>;
    for (const r of prows) {
      for (const l of extractLabels(r.raw_json, true)) {
        const k = l.name.toLowerCase();
        if (l.color && !m.has(k)) m.set(k, l.color);
      }
    }
  } catch {
    /* mirror unreadable — empty palette, callers fall back to name-based colors */
  }
  repoPaletteCache.set(repoLc, m);
  return m;
}

/** Attach GitHub labels to the returned PRs. The full set (with colors) comes from the
 * pulls mirror's raw_json when present; the /prs feed only mirrors a fraction of PRs, so
 * we always also surface the feed's scoring `label` (itself a real GitHub label) — that
 * guarantees a PR shows its label even when the local mirror lacks the row. The feed
 * label has no color, so we resolve its real GitHub color from the repo palette. */
function attachPrLabels(prs: MinerPr[]): void {
  if (prs.length === 0) return;
  try {
    const db = getReadDb();
    const stmt = db.prepare('SELECT raw_json FROM pulls WHERE LOWER(repo_full_name) = ? AND number = ?');
    for (const p of prs) {
      const row = stmt.get(p.repo.toLowerCase(), p.number) as { raw_json: string | null } | undefined;
      if (row?.raw_json) p.labels = extractLabels(row.raw_json, true);
    }
  } catch {
    /* pulls table absent / unreadable — feed-label fallback below still applies */
  }
  for (const p of prs) {
    const sl = p.label;
    // Defer the catch-all "other" to enrichLabelsFromGitHub — it's usually synthetic, but
    // some repos define a real "other" label, which we only know from the GitHub palette.
    if (sl && sl.toLowerCase() !== 'other' && !p.labels.some((l) => l.name.toLowerCase() === sl.toLowerCase())) {
      const color = repoLabelColors(p.repo.toLowerCase()).get(sl.toLowerCase());
      p.labels = [...p.labels, color ? { name: sl, color } : { name: sl }];
    }
  }
}

/** Real GitHub label palette for a repo, fetched live and cached in-memory (label
 * colors are effectively static). Covers labels our local mirror never sees — e.g.
 * custom PR-only labels (a repo's issues may only ever use "other") — so a feed label
 * gets its true github.com color instead of the gray name-based fallback. */
const GH_LABEL_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const ghLabelCache = new Map<string, { at: number; palette: Map<string, string> }>();

async function githubRepoLabelPalette(repoFullName: string): Promise<Map<string, string>> {
  const key = repoFullName.toLowerCase();
  const hit = ghLabelCache.get(key);
  if (hit && Date.now() - hit.at < GH_LABEL_TTL_MS) return hit.palette;

  const palette = new Map<string, string>();
  try {
    const [owner, repo] = repoFullName.split('/');
    if (owner && repo) {
      const res = await withRotation((octokit) => octokit.issues.listLabelsForRepo({ owner, repo, per_page: 100 }));
      for (const l of res.data) {
        if (l?.name && typeof l.color === 'string') palette.set(l.name.toLowerCase(), l.color);
      }
    }
  } catch {
    /* repo labels unavailable (rate limit / missing) — empty palette, callers keep fallback */
  }
  ghLabelCache.set(key, { at: Date.now(), palette });
  return palette;
}

/** A miner's PRs in one repo → their real GitHub labels, by PR number. One paginated
 * listForRepo(creator) call (PRs are issues on GitHub, returned with their labels),
 * cached. Fills labels the scoring feed never carries (e.g. "ci", "size:L") and the
 * mirror lacks (no raw_json) — the only way to label such PRs in the contributions table. */
const ghPrLabelCache = new Map<string, { at: number; byNumber: Map<number, GhLabel[]> }>();
const GH_PR_LABEL_CACHE_MAX = 500; // bound the repo::login cache so it can't grow without limit

async function githubRepoPrLabels(repoFullName: string, login: string): Promise<Map<number, GhLabel[]>> {
  const key = `${repoFullName}::${login}`.toLowerCase();
  const hit = ghPrLabelCache.get(key);
  if (hit && Date.now() - hit.at < GH_LABEL_TTL_MS) return hit.byNumber;

  const byNumber = new Map<number, GhLabel[]>();
  try {
    const [owner, repo] = repoFullName.split('/');
    if (owner && repo) {
      for (let page = 1; page <= 3; page++) {
        const res = await withRotation((octokit) =>
          octokit.issues.listForRepo({ owner, repo, creator: login, state: 'all', per_page: 100, page }),
        );
        for (const it of res.data) {
          if (!it.pull_request) continue; // issues come back too; keep only PRs
          const labels: GhLabel[] = (it.labels ?? [])
            .map((l) => (typeof l === 'string' ? { name: l } : { name: l.name ?? '', color: typeof l.color === 'string' ? l.color : undefined }))
            .filter((l) => l.name);
          byNumber.set(it.number, labels);
        }
        if (res.data.length < 100) break;
      }
    }
  } catch {
    /* unavailable (rate limit / missing) — empty map, callers keep existing labels */
  }
  if (ghPrLabelCache.size >= GH_PR_LABEL_CACHE_MAX) {
    const oldest = ghPrLabelCache.keys().next().value;
    if (oldest !== undefined) ghPrLabelCache.delete(oldest);
  }
  ghPrLabelCache.set(key, { at: Date.now(), byNumber });
  return byNumber;
}

// Bound the live-GitHub label fallback so opening one modal can't burst the API: at most
// GH_CONCURRENCY requests in flight and at most GH_MAX_REPOS repos enriched per request
// (the rest keep their mirror/feed labels). The local mirror stays the primary source.
const GH_CONCURRENCY = 4;
const GH_MAX_REPOS = 10;

async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const idx = next++;
        if (idx >= items.length) return;
        await worker(items[idx]);
      }
    }),
  );
}

/** Fill in real GitHub labels for PRs the local mirror/feed left label-less, fetching one
 * listForRepo(creator) per affected repo (cached, in parallel). Only touches PRs with no
 * labels yet — PRs that already have a scoring/raw_json label keep it. */
async function attachGithubPrLabels(prs: MinerPr[], login: string): Promise<void> {
  if (!login || prs.length === 0) return;
  const needy = new Set<string>();
  for (const p of prs) if (p.labels.length === 0) needy.add(p.repo);
  if (needy.size === 0) return;

  const maps = new Map<string, Map<number, GhLabel[]>>();
  // Cap + concurrency-limit the per-repo GitHub fan-out (≤ GH_MAX_REPOS listForRepo flows).
  await mapLimit([...needy].slice(0, GH_MAX_REPOS), GH_CONCURRENCY, async (repo) => {
    maps.set(repo.toLowerCase(), await githubRepoPrLabels(repo, login));
  });
  for (const p of prs) {
    if (p.labels.length > 0) continue;
    const got = maps.get(p.repo.toLowerCase())?.get(p.number);
    if (got && got.length > 0) p.labels = got;
  }
}

/** Reconcile rendered labels with the repo's real GitHub palette, so chips match
 * github.com exactly even for labels absent from our local mirror. Fetches one palette
 * per distinct repo (cached, in parallel) and only when something needs it. Two jobs:
 *  - Fill any label still missing a color.
 *  - Surface gittensor's catch-all "other" scoring-label as a chip ONLY where the repo
 *    actually defines an "other" label (e.g. PR #509 here) — staying hidden where "other"
 *    is purely synthetic (the common case, no such GitHub label). */
async function enrichLabelsFromGitHub(prs: MinerPr[], issues: MinerIssue[]): Promise<void> {
  const rows: Array<{ repo: string; labels: Array<{ name: string; color?: string }> }> = [...prs, ...issues];

  const needy = new Set<string>();
  for (const r of rows) {
    if (r.labels.some((l) => !l.color)) needy.add(r.repo);
  }
  for (const p of prs) {
    if ((p.label ?? '').toLowerCase() === 'other' && !p.labels.some((l) => l.name.toLowerCase() === 'other')) {
      needy.add(p.repo);
    }
  }
  if (needy.size === 0) return;

  const palettes = new Map<string, Map<string, string>>();
  // Same bound as the PR-label fan-out — never burst the GitHub API from one request.
  await mapLimit([...needy].slice(0, GH_MAX_REPOS), GH_CONCURRENCY, async (repo) => {
    palettes.set(repo.toLowerCase(), await githubRepoLabelPalette(repo));
  });

  // Surface a real "other" label where the repo defines one.
  for (const p of prs) {
    if ((p.label ?? '').toLowerCase() !== 'other') continue;
    if (p.labels.some((l) => l.name.toLowerCase() === 'other')) continue;
    const color = palettes.get(p.repo.toLowerCase())?.get('other');
    if (color) p.labels = [...p.labels, { name: 'other', color }];
  }

  // Fill any label still lacking a color from the repo's real GitHub palette.
  for (const r of rows) {
    const pal = palettes.get(r.repo.toLowerCase());
    if (!pal || pal.size === 0) continue;
    for (const l of r.labels) {
      if (!l.color) {
        const c = pal.get(l.name.toLowerCase());
        if (c) l.color = c;
      }
    }
  }
}

async function refreshPrs(): Promise<PrCache> {
  const r = await fetch(PRS_URL, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`upstream ${PRS_URL} ${r.status}`);
  const all = (await r.json()) as UpstreamPr[];
  const prs: IndexedPr[] = all.map((p) => ({
    repo: p.repository,
    number: p.pullRequestNumber,
    title: p.pullRequestTitle,
    state: deriveState(p),
    score: num(p.score),
    createdAt: p.prCreatedAt,
    mergedAt: p.mergedAt,
    closedAt: null, // the scored feed carries merged PRs; closed-not-merged come from the mirror
    additions: num(p.additions),
    deletions: num(p.deletions),
    linkedIssueNumber: parseLinkedIssue(p.pullRequestTitle),
    author: p.author ?? '',
    hotkey: typeof p.hotkey === 'string' ? p.hotkey : '',
    commitCount: num(p.commitCount),
    baseScore: num(p.baseScore),
    collateralScore: num(p.collateralScore),
    tokenScore: num(p.tokenScore),
    totalNodesScored: num(p.totalNodesScored),
    structuralCount: num(p.structuralCount),
    structuralScore: num(p.structuralScore),
    leafCount: num(p.leafCount),
    leafScore: num(p.leafScore),
    label: typeof p.label === 'string' ? p.label : null,
    labelMultiplier: num(p.labelMultiplier),
    reviewQualityMultiplier: num(p.reviewQualityMultiplier),
    labels: [],
    authorLc: (p.author ?? '').toLowerCase(),
    githubId: p.githubId ? String(p.githubId) : '',
  }));
  prCache = { fetched_at: Date.now(), prs };
  return prCache;
}

async function getPrs(): Promise<IndexedPr[]> {
  const now = Date.now();
  if (prCache && now - prCache.fetched_at < TTL_MS) return prCache.prs;
  if (inFlight) return (await inFlight).prs;
  inFlight = refreshPrs().finally(() => {
    inFlight = null;
  });
  try {
    return (await inFlight).prs;
  } catch (err) {
    if (prCache) return prCache.prs; // serve stale on a transient upstream failure
    throw err;
  }
}

interface IssueRow {
  repo_full_name: string;
  number: number;
  title: string;
  state: string;
  state_reason: string | null;
  html_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  labels: string | null;
}

/** A miner's issues from the local mirror, newest first. Returns [] if the issues
 *  table isn't present/populated in this environment (graceful — PRs still show). */
function getIssues(login: string): MinerIssue[] {
  if (!login) return [];
  try {
    const db = getReadDb();
    const rows = db
      .prepare(
        `SELECT repo_full_name, number, title, state, state_reason, html_url, created_at, updated_at, closed_at, labels
           FROM issues
          WHERE author_login IS NOT NULL AND LOWER(author_login) = LOWER(?)
          ORDER BY updated_at DESC
          LIMIT ?`,
      )
      .all(login, MAX) as IssueRow[];
    return rows.map((r) => ({
      repo: r.repo_full_name,
      number: r.number,
      title: r.title,
      state: r.state,
      stateReason: r.state_reason,
      htmlUrl: r.html_url,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      closedAt: r.closed_at,
      labels: extractLabels(r.labels, false),
    }));
  } catch {
    return [];
  }
}

interface DbPullRow {
  repo_full_name: string;
  number: number;
  title: string | null;
  state: string | null;
  merged: number | null;
  created_at: string | null;
  merged_at: string | null;
  closed_at: string | null;
  raw_json: string | null;
  author_login: string | null;
}

/** The miner's PRs from the pulls mirror — fills in PRs the /prs feed doesn't score
 * (e.g. a maintainer's own PRs on their own repo: gittensor scores cross-repo
 * contributions, not the owner's). Unscored, so score / scoring fields are 0; state,
 * dates and labels come from the mirror. Returns [] if the table isn't present. */
function getDbPulls(login: string): IndexedPr[] {
  if (!login) return [];
  try {
    const db = getReadDb();
    const rows = db
      .prepare(
        `SELECT repo_full_name, number, title, state, merged, created_at, merged_at, closed_at, raw_json, author_login
           FROM pulls
          WHERE author_login IS NOT NULL AND LOWER(author_login) = LOWER(?)
          ORDER BY COALESCE(merged_at, created_at) DESC
          LIMIT ?`,
      )
      .all(login, MAX) as DbPullRow[];
    return rows.map((r) => ({
      repo: r.repo_full_name,
      number: r.number,
      title: r.title ?? '',
      state: r.merged ? 'MERGED' : (r.state ?? '').toLowerCase() === 'closed' ? 'CLOSED' : 'OPEN',
      score: 0,
      createdAt: r.created_at ?? '',
      mergedAt: r.merged_at,
      closedAt: r.merged ? null : r.closed_at,
      additions: 0,
      deletions: 0,
      linkedIssueNumber: parseLinkedIssue(r.title ?? ''),
      author: r.author_login ?? '',
      hotkey: '',
      commitCount: 0,
      baseScore: 0,
      collateralScore: 0,
      tokenScore: 0,
      totalNodesScored: 0,
      structuralCount: 0,
      structuralScore: 0,
      leafCount: 0,
      leafScore: 0,
      label: null,
      labelMultiplier: 0,
      reviewQualityMultiplier: 0,
      labels: extractLabels(r.raw_json, true),
      authorLc: (r.author_login ?? '').toLowerCase(),
      githubId: '',
    }));
  } catch {
    return [];
  }
}

/** PR/issue lifecycle activity over the last 30 days (daily buckets), computed from
 * the FULL works set — so closed PRs aren't lost to the top-N PR truncation. The /prs
 * feed has no PR close date, so closed PRs' close timestamps come from the pulls
 * mirror (best-effort). */
function buildActivity(mine: IndexedPr[], issues: MinerIssue[]): MinerActivityPoint[] {
  const DAYS = 30;
  const DAY = 86_400_000;
  const bucketStart = (ts: number) => {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const last = bucketStart(Date.now());
  const start = last - (DAYS - 1) * DAY;
  const points: MinerActivityPoint[] = Array.from({ length: DAYS }, (_, i) => {
    const t = start + i * DAY;
    return {
      label: new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      openedPrs: 0,
      mergedPrs: 0,
      closedPrs: 0,
      openedIssues: 0,
      resolvedIssues: 0,
    };
  });
  const bump = (iso: string | null | undefined, key: keyof Omit<MinerActivityPoint, 'label'>) => {
    if (!iso) return;
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return;
    const i = Math.round((bucketStart(ts) - start) / DAY);
    if (i >= 0 && i < DAYS) points[i][key] += 1;
  };
  const closed: IndexedPr[] = [];
  for (const p of mine) {
    bump(p.createdAt, 'openedPrs');
    if (p.state === 'MERGED') bump(p.mergedAt, 'mergedPrs');
    else if (p.state === 'CLOSED') closed.push(p);
  }
  // Closed PRs need the pulls mirror's close timestamp (the feed carries none).
  if (closed.length > 0) {
    try {
      const stmt = getReadDb().prepare('SELECT closed_at FROM pulls WHERE LOWER(repo_full_name) = ? AND number = ?');
      for (const p of closed) {
        const row = stmt.get(p.repo.toLowerCase(), p.number) as { closed_at: string | null } | undefined;
        bump(row?.closed_at, 'closedPrs');
      }
    } catch {
      /* pulls mirror absent — closed-PR series stays empty */
    }
  }
  for (const it of issues) {
    bump(it.createdAt, 'openedIssues');
    if ((it.stateReason ?? '').toUpperCase() === 'COMPLETED') bump(it.closedAt ?? it.updatedAt, 'resolvedIssues');
  }
  return points;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const login = (url.searchParams.get('login') ?? '').trim();
  const githubId = (url.searchParams.get('githubId') ?? '').trim();
  if (!login && !githubId) {
    return NextResponse.json({ error: 'login or githubId required' }, { status: 400 });
  }

  let allPrs: IndexedPr[] = [];
  try {
    allPrs = await getPrs();
  } catch {
    allPrs = [];
  }
  const loginLc = login.toLowerCase();
  const mine = allPrs.filter((p) => (loginLc && p.authorLc === loginLc) || (githubId && p.githubId === githubId));

  // Supplement with PRs from the mirror that the /prs feed doesn't score (e.g. a
  // maintainer's PRs on their own repo). Deduped against the scored feed set,
  // case-insensitively (the feed lowercases repo names; the mirror keeps GitHub's).
  if (login) {
    const feedKeys = new Set(mine.map((p) => `${p.repo.toLowerCase()}#${p.number}`));
    for (const p of getDbPulls(login)) {
      if (!feedKeys.has(`${p.repo.toLowerCase()}#${p.number}`)) mine.push(p);
    }
  }

  // Most valuable first: merged (with score) on top, then by score, then recency.
  const stateRank = (s: MinerPr['state']) => (s === 'MERGED' ? 0 : s === 'OPEN' ? 1 : 2);
  mine.sort(
    (a, b) =>
      stateRank(a.state) - stateRank(b.state) ||
      b.score - a.score ||
      (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  );

  const prs: MinerPr[] = mine.slice(0, MAX).map((p) => ({
    repo: p.repo,
    number: p.number,
    title: p.title,
    state: p.state,
    score: p.score,
    createdAt: p.createdAt,
    mergedAt: p.mergedAt,
    closedAt: p.closedAt,
    additions: p.additions,
    deletions: p.deletions,
    linkedIssueNumber: p.linkedIssueNumber,
    author: p.author,
    hotkey: p.hotkey,
    commitCount: p.commitCount,
    baseScore: p.baseScore,
    collateralScore: p.collateralScore,
    tokenScore: p.tokenScore,
    totalNodesScored: p.totalNodesScored,
    structuralCount: p.structuralCount,
    structuralScore: p.structuralScore,
    leafCount: p.leafCount,
    leafScore: p.leafScore,
    label: p.label,
    labelMultiplier: p.labelMultiplier,
    reviewQualityMultiplier: p.reviewQualityMultiplier,
    labels: p.labels,
  }));
  attachPrLabels(prs);
  // Fill PRs the mirror/feed left label-less (e.g. external-repo PRs with "ci"/"size:L")
  // with their real GitHub labels, so they show in the contributions table — not just the
  // detail view.
  // Canonical login for the live GitHub PR-label lookup: derive it from the matched PRs'
  // own author, never the raw `login` param — otherwise a request pairing a valid githubId
  // with an arbitrary login would spend GitHub quota under that login (listForRepo
  // creator=login) and pollute the repo::login cache. >1 distinct author (ambiguous) → skip.
  const prAuthors = new Set(mine.map((p) => p.authorLc).filter(Boolean));
  const ghLookupLogin = prAuthors.size === 1 ? [...prAuthors][0] : '';
  await attachGithubPrLabels(prs, ghLookupLogin);
  const issues = getIssues(login);
  // Reconcile labels with each repo's real GitHub palette (fill colors + surface a
  // genuine "other" label where the repo defines one).
  await enrichLabelsFromGitHub(prs, issues);

  const counts = {
    prs: mine.length,
    prMerged: mine.filter((p) => p.state === 'MERGED').length,
    prOpen: mine.filter((p) => p.state === 'OPEN').length,
    prClosed: mine.filter((p) => p.state === 'CLOSED').length,
    issues: issues.length,
    issuesOpen: issues.filter((i) => i.state === 'open').length,
    issuesCompleted: issues.filter((i) => (i.stateReason ?? '').toUpperCase() === 'COMPLETED').length,
  };

  const activity = buildActivity(mine, issues);
  const body: MinerWorksResponse = { prs, issues, counts, activity };
  return NextResponse.json(body);
}
