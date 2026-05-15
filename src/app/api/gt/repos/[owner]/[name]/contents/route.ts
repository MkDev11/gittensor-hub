import { NextResponse } from 'next/server';
import { withRotation } from '@/lib/github';

export const dynamic = 'force-dynamic';

const MAX_INLINE_BYTES = 512 * 1024; // 512 KB — refuse to send anything larger

function isProbablyText(buf: Buffer): boolean {
  // Heuristic used by git: a file is "binary" if its first 8 KB contains a NUL byte.
  const slice = buf.subarray(0, Math.min(buf.length, 8192));
  for (let i = 0; i < slice.length; i++) if (slice[i] === 0) return false;
  return true;
}

export async function GET(req: Request, { params }: { params: { owner: string; name: string } }) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get('path') ?? '';
  try {
    const r = await withRotation((octokit) =>
      octokit.rest.repos.getContent({ owner: params.owner, repo: params.name, path }),
    );
    const data = r.data;

    // Single file → decode and return content (text only; binaries get a flag).
    if (!Array.isArray(data)) {
      const file = data as {
        type: string;
        name: string;
        path: string;
        size: number;
        html_url: string | null;
        download_url: string | null;
        sha: string;
        encoding?: string;
        content?: string;
      };
      if (file.type !== 'file') {
        return NextResponse.json({ isFile: true, path: file.path, missing: true });
      }

      const sizeOk = file.size <= MAX_INLINE_BYTES;
      let content: string | null = null;
      let isBinary = false;
      let truncated = false;

      if (sizeOk && file.encoding === 'base64' && typeof file.content === 'string') {
        const buf = Buffer.from(file.content, 'base64');
        if (isProbablyText(buf)) {
          content = buf.toString('utf8');
        } else {
          isBinary = true;
        }
      } else if (!sizeOk) {
        truncated = true;
      }

      return NextResponse.json({
        isFile: true,
        path: file.path,
        name: file.name,
        size: file.size,
        sha: file.sha,
        htmlUrl: file.html_url,
        downloadUrl: file.download_url,
        content,
        isBinary,
        truncated,
      });
    }

    // Directory listing
    const items = data.map((it) => ({
      name: it.name,
      path: it.path,
      type: it.type,
      size: it.size,
      htmlUrl: it.html_url,
    }));
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // Latest commit on this path — surfaced in the "Code" tab header.
    let lastCommit: { sha: string; message: string; author: string; committedAt: string } | null = null;
    try {
      const commits = await withRotation((octokit) =>
        octokit.rest.repos.listCommits({ owner: params.owner, repo: params.name, path: path || undefined, per_page: 1 }),
      );
      const c = commits.data[0];
      if (c) {
        lastCommit = {
          sha: c.sha.slice(0, 7),
          message: c.commit.message.split('\n')[0],
          author: c.commit.author?.name || c.author?.login || '',
          committedAt: c.commit.author?.date || '',
        };
      }
    } catch {
      lastCommit = null;
    }
    return NextResponse.json({ items, path, isFile: false, lastCommit });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 0;
    if (status === 404) return NextResponse.json({ items: [], path, isFile: false, missing: true });
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
