import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Doc } from "../convex/_generated/dataModel";
const state = vi.hoisted(() => ({
  path: "/",
  gates: 0,
  user: null as Doc<"users"> | null,
  replacements: [] as string[],
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    replace: (path: string) => state.replacements.push(path),
  }),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => void) => effect(),
}));
vi.mock("@/app/components/SchoolGate", () => ({
  UserGate: ({
    children,
  }: {
    children: (user: Doc<"users">) => React.ReactNode;
  }) => {
    state.gates++;
    return state.user ? children(state.user) : "Protected";
  },
  Centered: ({ children }: { children: React.ReactNode }) => children,
}));
import { Workspace } from "../app/components/Workspace";
import Login from "../app/login/page";
beforeEach(() => {
  state.gates = 0;
  state.user = null;
  state.replacements = [];
});
describe("public routes", () => {
  it.each(["/", "/login"])(
    "renders %s without the authentication gate",
    (path) => {
      state.path = path;
      expect(
        renderToStaticMarkup(createElement(Workspace, null, "Public content")),
      ).toBe("Public content");
      expect(state.gates).toBe(0);
    },
  );
  it.each([
    "/school",
    "/supplier",
    "/county",
    "/admin",
    "/reader",
    "/login/other",
  ])("keeps %s protected", (path) => {
    state.path = path;
    expect(
      renderToStaticMarkup(createElement(Workspace, null, "Private content")),
    ).toBe("Protected");
    expect(state.gates).toBe(1);
  });
});
describe("login destination", () => {
  it.each(["school", "supplier", "county", "admin"] as const)(
    "opens the primary %s dashboard",
    (role) => {
      state.user = { role, schoolId: "school-id" } as Doc<"users">;
      const html = renderToStaticMarkup(createElement(Login));
      expect(state.replacements).toEqual([`/${role}`]);
      expect(html).toContain(`href="/${role}"`);
    },
  );
  it("keeps a school user without an assigned school out of dashboards", () => {
    state.user = { role: "school" } as Doc<"users">;
    const html = renderToStaticMarkup(createElement(Login));
    expect(state.replacements).toEqual([]);
    expect(html).toContain("Ask your programme administrator");
  });
});
