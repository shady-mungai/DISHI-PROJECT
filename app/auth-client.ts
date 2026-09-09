import type { AuthClient } from "@convex-dev/better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// The pinned better-auth/@convex-dev/better-auth versions disagree on the
// convex plugin's generic shape, so `createAuthClient`'s return type doesn't
// structurally match `AuthClient` even though the runtime shape does. Cast
// through `unknown` rather than loosen to `any`; revisit on the next bump.
export const authClient = createAuthClient({
  plugins: [convexClient()],
}) as unknown as AuthClient;
