import type { NextConfig } from "next";

// Allow the fixed HTTPS tunnel alongside local device testing.
const DEV_ORIGINS = ["dishi.2003.studio", "10.*.*.*", "192.168.*.*", "172.*.*.*"];

const nextConfig: NextConfig = {
  allowedDevOrigins: DEV_ORIGINS,
  async redirects() {
    return [{ source: "/service-day", destination: "/school", permanent: false }];
  },
};

export default nextConfig;
