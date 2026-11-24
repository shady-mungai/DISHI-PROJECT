import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { convexSiteUrl, convexUrl } from "./convex-urls";

export const { handler, getToken } = convexBetterAuthNextJs({
  convexUrl,
  convexSiteUrl,
});
