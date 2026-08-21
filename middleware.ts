import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  AUTH_COOKIE_MAX_AGE,
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_OPTIONS,
  safeRedirectPath,
} from '@/lib/auth';

const PUBLIC_PATHS = ['/api/auth', '/api/cron'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next();
  }

  const secret = process.env.COOKIE_SECRET;
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = secret && token === secret ? token : null;

  if (pathname.startsWith('/login')) {
    if (!session) return NextResponse.next();
    const target = safeRedirectPath(request.nextUrl.searchParams.get('from'));
    return NextResponse.redirect(new URL(target, request.url));
  }

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();

  // Re-issue the cookie on page views so its expiry keeps moving forward and a
  // regular user is never asked for the password a second time. API responses
  // are left alone to avoid a Set-Cookie header on every data fetch.
  if (!pathname.startsWith('/api')) {
    response.cookies.set(AUTH_COOKIE_NAME, session, {
      ...AUTH_COOKIE_OPTIONS,
      maxAge: AUTH_COOKIE_MAX_AGE,
    });
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
