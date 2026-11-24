const CONVEX_CLOUD_SUFFIX = /\.convex\.cloud$/;
const CONVEX_SITE_SUFFIX = ".convex.site";

export const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim() ?? "";

export const convexSiteUrl =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim() ||
  convexUrl.replace(CONVEX_CLOUD_SUFFIX, CONVEX_SITE_SUFFIX);
