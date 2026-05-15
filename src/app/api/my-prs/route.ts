import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { searchUserPRs } from '@/lib/github';
import { getSessionFromCookies, getUserById } from '@/lib/auth';
import { getLiveReposServer as getLiveRepos } from '@/lib/repos-server';

export const dynamic = 'force-dynamic';

/** Look up SN74 membership + weight from the live cache so newly-added repos
 *  start being credited as soon as upstream master_repositories.json picks
 *  them up. Cheap — the cache is in-memory and refreshes hourly. */
function lookupSn74(fullName: string): { in_whitelist: boolean; weight: number | null } {
  const key = fullName.toLowerCase();
  for (const r of getLiveRepos()) {
    if (r.fullName.toLowerCase() === key) return { in_whitelist: true, weight: r.weight };
  }
  return { in_whitelist: false, weight: null };
}

const FRESHNESS_MS = 60_000;
// Per-login freshness so multiple signed-in users don't share a single
// 60s cache window (which would make the second user's first request return
// nothing while the cache still points at the first user's results).
const lastFetchByLogin = new Map<string, number>();
const inFlightByLogin = new Map<string, Promise<void>>();

interface MyPullDto {
  repo_full_name: string;
  number: number;
  title: string;
  state: string;
  draft: number;
  merged: number;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  merged_at: string | null;
  html_url: string | null;
  body: string | null;
  in_whitelist: boolean;
  weight: number | null;
}

async function refreshMyPRsIfStale(login: string) {
  const last = lastFetchByLogin.get(login.toLowerCase()) ?? 0;
  if (Date.now() - last < FRESHNESS_MS) return;
  const inFlight = inFlightByLogin.get(login.toLowerCase());
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const items = await searchUserPRs(login);
      const db = getDb();
      const now = new Date().toISOString();
      const tx = db.transaction(() => {
        for (const it of items) {
          if (!it.pull_request) continue;
          const repo_full_name = it.repository_url.replace('https://api.github.com/repos/', '');
          const merged_at = it.pull_request.merged_at ?? null;
          db.prepare(
            `INSERT INTO pulls (repo_full_name, number, title, body, state, draft, merged, author_login,
                                created_at, updated_at, closed_at, merged_at, html_url, raw_json, fetched_at, first_seen_at)
             VALUES (@repo_full_name, @number, @title, @body, @state, @draft, @merged, @author_login,
                     @created_at, @updated_at, @closed_at, @merged_at, @html_url, @raw_json, @fetched_at, @first_seen_at)
             ON CONFLICT(repo_full_name, number) DO UPDATE SET
               title=excluded.title, body=excluded.body, state=excluded.state, draft=excluded.draft,
               merged=excluded.merged, updated_at=excluded.updated_at, closed_at=excluded.closed_at,
               merged_at=excluded.merged_at, html_url=excluded.html_url, raw_json=excluded.raw_json,
               fetched_at=excluded.fetched_at`
          ).run({
            repo_full_name,
            number: it.number,
            title: it.title,
            body: it.body,
            state: it.state,
            draft: it.draft ? 1 : 0,
            merged: merged_at ? 1 : 0,
            author_login: it.user?.login ?? login,
            created_at: it.created_at,
            updated_at: it.updated_at,
            closed_at: it.closed_at,
            merged_at,
            html_url: it.html_url,
            raw_json: JSON.stringify(it),
            fetched_at: now,
            first_seen_at: now,
          });
        }
      });
      tx();
      lastFetchByLogin.set(login.toLowerCase(), Date.now());
    } finally {
      inFlightByLogin.delete(login.toLowerCase());
    }
  })();
  inFlightByLogin.set(login.toLowerCase(), promise);
  return promise;
}

export async function GET() {
  const sess = await getSessionFromCookies();
  if (!sess) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const user = getUserById(sess.uid);
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const login = user.github_login;

  refreshMyPRsIfStale(login).catch(() => {});

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT repo_full_name, number, title, body, state, draft, merged,
              created_at, updated_at, closed_at, merged_at, html_url
       FROM pulls
       WHERE LOWER(author_login) = LOWER(?)
       ORDER BY updated_at DESC`
    )
    .all(login) as Omit<MyPullDto, 'in_whitelist' | 'weight'>[];

  const enriched: MyPullDto[] = rows.map((p) => ({
    ...p,
    ...lookupSn74(p.repo_full_name),
  }));

  const lastFetchAt = lastFetchByLogin.get(login.toLowerCase()) ?? 0;
  return NextResponse.json({
    login,
    count: enriched.length,
    in_whitelist_count: enriched.filter((p) => p.in_whitelist).length,
    last_fetch: lastFetchAt > 0 ? new Date(lastFetchAt).toISOString() : null,
    pulls: enriched,
  });
}
