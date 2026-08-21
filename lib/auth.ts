export const AUTH_COOKIE_NAME = 'auth_token';

// Browsers clamp persistent cookies to 400 days (RFC 6265bis), so a year is the
// longest lifetime that survives round-tripping unchanged. The middleware slides
// this window forward on every visit, so anyone who uses the tool at least once
// a year never sees the login screen again.
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

/**
 * Constrains a post-login redirect to a path on this site. `//host` and
 * `/\host` are treated as absolute by the URL parser, so they are rejected.
 */
export function safeRedirectPath(from: string | null | undefined): string {
  if (!from || !from.startsWith('/')) return '/';
  if (from.startsWith('//') || from.startsWith('/\\')) return '/';
  return from;
}
