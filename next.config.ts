import type { NextConfig } from "next";

// Phones on the LAN reach the dev server by IP; without this Next blocks its
// own dev assets (403) and the page never hydrates.
const LAN_DEV_ORIGINS = ["10.*.*.*", "192.168.*.*", "172.*.*.*"];

const nextConfig: NextConfig = {
  allowedDevOrigins: LAN_DEV_ORIGINS,
};

export default nextConfig;
