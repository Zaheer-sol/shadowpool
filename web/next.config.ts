import type { NextConfig } from "next";

/**
 * Static export: `next build` emits a plain HTML/JS bundle into `out/`, which
 * the ShadowPool node serves alongside its API. One service, one origin — the
 * frontend calls `/api/...` relatively, so there's no cross-service URL to
 * configure and no CORS to get wrong.
 *
 * This works because every page is client-rendered and talks to the node's API
 * at runtime; nothing is server-rendered per request.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true }, // required by static export
};

export default nextConfig;
