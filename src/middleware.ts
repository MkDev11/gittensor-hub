import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/session-token';

// Routes accessible without any session.
const PUBLIC_PATHS = new Set(['/sign-in']);
const PUBLIC_API_PREFIXES = ['/api/auth/'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return false;
}

// Pages a session-holder may visit even when status !== 'approved'. Anything
// not in this list redirects to /pending-approval for pending/rejected users.
const PENDING_ALLOWED_PAGES = new Set(['/pending-approval', '/sign-in']);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not authenticated', authenticated: false }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('next', pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // Admin-only routes (page + API)
  const isAdminRoute = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');
  if (isAdminRoute && !session.is_admin) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // Pending or rejected users get bounced to /pending-approval (except a small
  // allow-list so the polling refresh + sign-out still work).
  if (session.status !== 'approved') {
    if (pathname.startsWith('/api/')) return NextResponse.next();
    if (PENDING_ALLOWED_PAGES.has(pathname)) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = '/pending-approval';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Approved sessions trying to revisit /pending-approval just go home.
  if (pathname === '/pending-approval') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|gt-logo.png|gt-logo-white.png|robots.txt|sitemap.xml).*)',
  ],
};
