import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getLiveReposAsyncServer } from '@/lib/repos-server';

export const dynamic = 'force-dynamic';

interface ActivityRow {
  repo: string;
  issues: number;
  pulls: number;
}

interface RepoCountRow {
  repo: string;
  cnt: number;
}

type ViewedAtMap = Map<string, string>;

type BaselineRow = {
  repo: string;
  since: string;
};

function defaultSince(): string {
  return new Date(Date.now() - 24 * 3600 * 1000).toISOString();
}

function parseIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function laterIso(a: string, b: string): string {
  return new Date(b).getTime() > new Date(a).getTime() ? b : a;
}

function normalizeViewedAt(raw: unknown): ViewedAtMap {
  const map = new Map<string, string>();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return map;
  for (const [repo, value] of Object.entries(raw)) {
    const iso = parseIso(value);
    if (iso) map.set(repo.toLowerCase(), iso);
  }
  return map;
}

function addAllowedRepo(map: Map<string, string>, fullName: string) {
  map.set(fullName.toLowerCase(), fullName);
}

async function loadAllowedRepos(): Promise<Map<string, string>> {
  const allowedRepos = new Map<string, string>();
  try {
    const { repos: liveRepos } = await getLiveReposAsyncServer();
    for (const repo of liveRepos) addAllowedRepo(allowedRepos, repo.fullName);
  } catch (err) {
    console.error('[repo-activity] live repo fetch failed:', err instanceof Error ? err.message : err);
  }
  return allowedRepos;
}

function buildBaselines(allowedRepos: Map<string, string>, globalSince: string, viewedAt: ViewedAtMap): BaselineRow[] {
  return Array.from(allowedRepos.values()).map((repo) => {
    const viewed = viewedAt.get(repo.toLowerCase());
    return { repo, since: viewed ? laterIso(globalSince, viewed) : globalSince };
  });
}

function countOpenRows(db: ReturnType<typeof getDb>, baselines: BaselineRow[], kind: 'issues' | 'pulls'): RepoCountRow[] {
  if (baselines.length === 0) return [];
  const valuesSql = baselines.map(() => '(?, ?)').join(',');
  const params = baselines.flatMap((row) => [row.repo, row.since]);
  const table = kind === 'issues' ? 'issues' : 'pulls';
  const alias = kind === 'issues' ? 'i' : 'p';
  const openFilter = kind === 'issues'
    ? "i.state = 'open'"
    : "p.state = 'open' AND p.draft = 0 AND p.merged = 0";

  try {
    return db
      .prepare(
        `WITH baselines(repo, since) AS (VALUES ${valuesSql})
         SELECT ${alias}.repo_full_name AS repo, COUNT(*) AS cnt
         FROM ${table} ${alias}
         JOIN baselines b ON b.repo = ${alias}.repo_full_name
         WHERE ${openFilter}
           AND COALESCE(${alias}.created_at, '') > b.since
           AND ${alias}.first_seen_at > b.since
         GROUP BY ${alias}.repo_full_name`,
      )
      .all(...params) as RepoCountRow[];
  } catch (err) {
    // Schema drift / unindexed scan / sqlite lock can throw here. Degrade
    // gracefully — the whole route still renders, just without this kind's
    // baseline counts. Production logs get the actual cause.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[repo-activity] countOpenRows(${kind}) failed: ${msg}`);
    return [];
  }
}

async function activityResponse(sinceInput: unknown, viewedInput: unknown) {
  const since = parseIso(sinceInput) ?? defaultSince();
  const viewedAt = normalizeViewedAt(viewedInput);
  const db = getDb();
  const allowedRepos = await loadAllowedRepos();

  if (allowedRepos.size === 0) {
    return NextResponse.json({ since, baselines: {}, activity: {} });
  }

  const baselines = buildBaselines(allowedRepos, since, viewedAt);
  const baselinesByRepo = Object.fromEntries(baselines.map((row) => [row.repo, row.since]));
  const issueRows = countOpenRows(db, baselines, 'issues');
  const pullRows = countOpenRows(db, baselines, 'pulls');

  const map: Record<string, ActivityRow> = {};
  for (const r of issueRows) {
    const repo = allowedRepos.get(r.repo.toLowerCase());
    if (!repo) continue;
    map[repo] = { repo, issues: r.cnt, pulls: 0 };
  }
  for (const r of pullRows) {
    const repo = allowedRepos.get(r.repo.toLowerCase());
    if (!repo) continue;
    if (!map[repo]) map[repo] = { repo, issues: 0, pulls: r.cnt };
    else map[repo].pulls = r.cnt;
  }

  return NextResponse.json({ since, baselines: baselinesByRepo, activity: map });
}

/** Last-resort wrapper around activityResponse — guarantees the client
 *  always gets a structured JSON body (never a generic 500 from an
 *  uncaught throw). The actual error is logged for diagnosis.
 *  Returns 200 + empty-activity payload instead of 5xx so the consumer
 *  (RepoExplorer.tsx — treats !r.ok as fatal and leaves its skeleton
 *  spinning) unblocks the render. The `error` field is there for any
 *  caller that wants to surface it. */
async function safeActivityResponse(sinceInput: unknown, viewedInput: unknown) {
  try {
    return await activityResponse(sinceInput, viewedInput);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[repo-activity] handler crashed:', msg, err instanceof Error ? err.stack : undefined);
    return NextResponse.json({
      since: defaultSince(),
      baselines: {},
      activity: {},
      error: msg,
    });
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  return safeActivityResponse(url.searchParams.get('since'), null);
}

export async function POST(req: NextRequest) {
  let body: { since?: unknown; viewed_at?: unknown };
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    body = parsed as { since?: unknown; viewed_at?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  return safeActivityResponse(body.since, body.viewed_at);
}
