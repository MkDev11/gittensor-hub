import { NextResponse } from 'next/server';
import { withRotation } from '@/lib/github';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ owner: string; name: string }> }) {
  const params = await ctx.params;
  try {
    const r = await withRotation((octokit) =>
      octokit.rest.repos.getReadme({
        owner: params.owner,
        repo: params.name,
        mediaType: { format: 'raw' },
      }),
    );
    // mediaType:raw makes the SDK return the raw markdown string in `data`.
    const content = typeof r.data === 'string' ? r.data : '';
    return NextResponse.json({ content });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 0;
    if (status === 404) {
      return NextResponse.json({ content: null, missing: true });
    }
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
