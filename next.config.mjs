/** @type {import('next').NextConfig} */
const nextConfig = {
  // Served at the host root on Vercel; under NEXT_PUBLIC_BASE_PATH ("/intel")
  // on the droplet beside the AMO dashboard. See lib/base-path.ts.
  ...(process.env.NEXT_PUBLIC_BASE_PATH ? { basePath: process.env.NEXT_PUBLIC_BASE_PATH } : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ["better-sqlite3", "pg"],
}

export default nextConfig
