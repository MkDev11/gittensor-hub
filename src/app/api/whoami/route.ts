import { NextResponse } from 'next/server';
import { getLatestPatOctokit } from '@/lib/github';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const octokit = getLatestPatOctokit();
    const { data } = await octokit.users.getAuthenticated();
    return NextResponse.json({
      login: data.login,
      name: data.name,
      avatar_url: data.avatar_url,
      html_url: data.html_url,
      bio: data.bio,
      company: data.company,
      location: data.location,
      public_repos: data.public_repos,
      followers: data.followers,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, authenticated: false }, { status: 401 });
  }
}
