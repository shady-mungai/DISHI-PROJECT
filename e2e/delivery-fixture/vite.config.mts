import { defineConfig } from "vite";
export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  resolve: {
    alias: [
      {
        find: "convex/react",
        replacement: new URL("./mock-convex.ts", import.meta.url).pathname,
      },
      {
        find: "@/app/auth-client",
        replacement: new URL("./mock-auth.ts", import.meta.url).pathname,
      },
      { find: "@", replacement: new URL("../../", import.meta.url).pathname },
    ],
  },
  define: {
    "process.env.NEXT_PUBLIC_CONVEX_SITE_URL": JSON.stringify(
      "http://localhost:3102",
    ),
    "process.env.NEXT_PUBLIC_CONVEX_URL": JSON.stringify(
      "http://localhost:3102",
    ),
  },
  server: { host: "127.0.0.1", port: 3102, strictPort: true },
});
