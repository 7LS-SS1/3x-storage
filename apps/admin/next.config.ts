import type { NextConfig } from "next";
import { config as loadEnvironment } from "dotenv";
import { resolve } from "node:path";

loadEnvironment({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const apiBaseUrl = new URL(
  process.env.NODE_ENV === "production"
    ? process.env.API_URL || "http://localhost:4000"
    : process.env.LOCAL_API_URL || "http://localhost:4000"
).origin;

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  transpilePackages: ["@video/player"],
  poweredByHeader: false,
  async rewrites() {
    return [{
      source: "/backend/:path*",
      destination: `${apiBaseUrl}/api/v1/:path*`
    }];
  },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" }
      ]
    }];
  }
};
export default config;
