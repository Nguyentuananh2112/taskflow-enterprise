import path from 'node:path';

import type { NextConfig } from 'next';

const monorepoRoot = path.join(import.meta.dirname, '../..');

const nextConfig: NextConfig = {
  // Image Docker dùng bản standalone (devops.md §3.2).
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  poweredByHeader: false,
  reactStrictMode: true,
  // @taskflow/contracts là workspace package (source .ts): Turbopack tự transpile, không cần transpilePackages.
};

export default nextConfig;
