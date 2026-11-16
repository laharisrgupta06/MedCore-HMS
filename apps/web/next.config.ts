import type { NextConfig } from 'next';

/**
 * Same-origin API proxy (approved decision): the browser only talks to this Next.js
 * origin, and /api/* is forwarded to the NestJS API. This keeps the httpOnly,
 * SameSite=Strict refresh cookie first-party. API_INTERNAL_URL is server-only.
 */
const apiOrigin = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Linting runs once for the whole monorepo via `pnpm lint` (root eslint.config.mjs).
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
