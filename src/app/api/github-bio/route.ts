/* A miner's GitHub profile blurb (bio + display name) for the miner detail modal.
 * Fetched via the app's GitHub client and cached in-memory (bios rarely change).
 * Public GitHub user data only — NOT the local auth/users DB. */

import { NextRequest, NextResponse } from 'next/server';
import { withRotation } from '@/lib/github';

export const dynamic = 'force-dynamic';

const TTL_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_CACHE = 1000; // bound the in-memory cache so it can't grow without limit

interface Profile {
  bio: string | null;
  name: string | null;
  followers: number | null;
  following: number | null;
}
const cache = new Map<string, { at: number; profile: Profile }>();
const EMPTY: Profile = { bio: null, name: null, followers: null, following: null };

export async function GET(req: NextRequest) {
  const login = (new URL(req.url).searchParams.get('login') ?? '').trim();
  if (!login) return NextResponse.json({ error: 'login required' }, { status: 400 });

  const key = login.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.profile);

  try {
    const { data } = await withRotation((octokit) => octokit.users.getByUsername({ username: login }));
    const profile: Profile = {
      bio: typeof data.bio === 'string' && data.bio.trim() ? data.bio.trim() : null,
      name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null,
      followers: typeof data.followers === 'number' ? data.followers : null,
      following: typeof data.following === 'number' ? data.following : null,
    };
    if (cache.size >= MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { at: Date.now(), profile });
    return NextResponse.json(profile);
  } catch {
    return NextResponse.json(EMPTY);
  }
}
