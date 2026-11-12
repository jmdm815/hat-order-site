import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The sanmar.com shopping-box robot (lib/sanmar-web.ts) runs headless
  // Chromium; its compressed binary lives outside the JS bundle.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/admin/sanmar-web/**": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/admin/sanmar-order/send-to-box": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "cdnm.sanmar.com",
      },
    ],
  },
};

export default nextConfig;
