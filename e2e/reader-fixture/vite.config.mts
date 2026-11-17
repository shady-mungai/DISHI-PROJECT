import { defineConfig } from "vite";
export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  resolve: { alias: { "@": new URL("../../", import.meta.url).pathname } },
  define: {
    "process.env.NEXT_PUBLIC_CONVEX_SITE_URL": JSON.stringify(
      "http://localhost:3101",
    ),
  },
  server: { host: "127.0.0.1", port: 3101, strictPort: true },
});
