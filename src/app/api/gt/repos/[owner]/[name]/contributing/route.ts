import { NextResponse } from 'next/server';
import { withRotation } from '@/lib/github';

export const dynamic = 'force-dynamic';

const CANDIDATES = [
  'CONTRIBUTING.md',
  'CONTRIBUTING.MD',
  'docs/CONTRIBUTING.md',
  '.github/CONTRIBUTING.md',
  'contributing.md',
];

export async function GET(_req: Request, { params }: { params: { owner: string; name: string } }) {
  for (const path of CANDIDATES) {
    try {
      const r = await withRotation((octokit) =>
        octokit.rest.repos.getContent({
          owner: params.owner,
          repo: params.name,
          path,
          mediaType: { format: 'raw' },
        }),
      );
      const content = typeof r.data === 'string' ? r.data : '';
      if (content) return NextResponse.json({ content, path });
    } catch (err) {
      const status = (err as { status?: number })?.status ?? 0;
      if (status === 404) continue;
      return NextResponse.json({ error: String(err) }, { status: 502 });
    }
  }
  return NextResponse.json({ content: null, missing: true });
}
