// The path the app is served under. Empty on Vercel; "/intel" on the droplet,
// where it sits beside the AMO dashboard behind one nginx. Next.js prefixes
// <Link>, the router and its own assets with `basePath` automatically, but a
// hand-written fetch("/api/...") is sent to the host root, so client code goes
// through withBasePath(). NEXT_PUBLIC_ variables are inlined at build time.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`
}
