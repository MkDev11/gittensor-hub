import type { NextRequest } from 'next/server';

/**
 * Derive the externally-visible origin (scheme + host[:port]) from a request.
 * Next.js's `req.nextUrl.origin` is unreliable in dev — it can report
 * `http://localhost:<port>` even when the browser hit a public IP / domain.
 * For OAuth redirect_uri to match what's registered on the GitHub OAuth App,
 * we need to use the host the *browser* actually sent.
 */
export function publicOrigin(req: NextRequest): string {
  const headers = req.headers;
  const proto = headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '') || 'http';
  const host = headers.get('x-forwarded-host') || headers.get('host') || req.nextUrl.host;
  return `${proto}://${host}`;
}
