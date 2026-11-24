import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

const CONVEX_CLOUD_SUFFIX = /\.convex\.cloud$/;
const CONVEX_SITE_SUFFIX = ".convex.site";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim() ?? "";
const convexSiteUrl =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim() ||
  convexUrl.replace(CONVEX_CLOUD_SUFFIX, CONVEX_SITE_SUFFIX);

export const { handler, getToken } = convexBetterAuthNextJs({
  convexUrl,
  convexSiteUrl,
});
