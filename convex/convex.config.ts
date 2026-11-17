import { v } from "convex/values";
import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";

import rateLimiter from "@convex-dev/rate-limiter/convex.config";

const app = defineApp({ env: { GROQ_API_KEY: v.optional(v.string()) } });
app.use(betterAuth);
app.use(rateLimiter);

export default app;
