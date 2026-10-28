import type { NextConfig } from 'next';

// standalone: the Docker image on the demo EC2 runs .next/standalone/server.js (Vercel ignores it).
const nextConfig: NextConfig = {
  output: 'standalone',
  // No "X-Powered-By: Next.js" (same as hiding Caddy's Server header).
  poweredByHeader: false,
};

export default nextConfig;
