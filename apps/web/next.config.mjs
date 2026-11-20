import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.API_URL ?? 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // NEXT_DIST_DIR lets a check build run without touching a running dev server's .next folder.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@icpd/shared'],
  webpack(config) {
    config.resolve.alias['@'] = here;
    return config;
  },
  // Same-origin proxy so the httpOnly session cookies work without third-party cookies.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};
export default nextConfig;
