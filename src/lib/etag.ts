import { NextResponse } from 'next/server';
import { createHash } from 'crypto';

/**
 * Build a strong ETag from a deterministic version key (e.g. the repo's
 * last_fetch timestamp combined with the request's query params).
 */
export function buildEtag(parts: Array<string | number | null | undefined>): string {
  const raw = parts.map((p) => (p == null ? '' : String(p))).join('|');
  return `"${createHash('sha1').update(raw).digest('base64url').slice(0, 16)}"`;
}

/**
 * If the inbound If-None-Match matches the freshly-computed ETag, return a
 * 304 response with the ETag echoed back. Otherwise return null and the
 * caller should produce a normal 200.
 */
export function etagNotModified(req: Request, etag: string): NextResponse | null {
  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'private, must-revalidate' },
    });
  }
  return null;
}

/**
 * Standard cache headers for our dynamic endpoints — let the browser cache,
 * but force a revalidation roundtrip every time so stale data doesn't sneak
 * through. The 304 path makes the revalidation cheap.
 */
export const CACHE_HEADERS = {
  ETag: '',
  'Cache-Control': 'private, must-revalidate',
};

export function withEtagHeaders(etag: string): Record<string, string> {
  return { ETag: etag, 'Cache-Control': 'private, must-revalidate' };
}
