import { describe, expect, it, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";

const state = vi.hoisted(() => ({
  queries: [] as string[],
  role: "school",
  schoolId: "school-id",
  params: new URLSearchParams("date=2026-10-20"),
  summary: undefined as
    { pending: number; fulfilled: number; missed: number } | undefined,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => state.params,
  usePathname: () => "/school",
}));
vi.mock("@/app/components/SchoolGate", () => ({
  SchoolGate: ({ children }: { children: (id: Id<"schools">) => unknown }) =>
    children(state.schoolId as Id<"schools">),
  UserGate: ({ children }: { children: (user: object) => unknown }) =>
    children({ role: state.role, schoolId: state.schoolId }),
  Centered: ({ children }: { children: unknown }) => children,
}));
vi.mock("convex/react", () => ({
  useQuery: (
    reference: Parameters<typeof getFunctionName>[0],
    args: unknown,
  ) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(reference);
    state.queries.push(name);
    if (name === "expectations:daySummary") return state.summary;
    if (name === "deliveryDashboard:forecasts")
      return [
        {
          schoolId: state.schoolId,
          schoolName: "Pilot Primary School",
          state: "unavailable",
        },
      ];
    return undefined;
  },
  usePaginatedQuery: (reference: Parameters<typeof getFunctionName>[0]) => {
    state.queries.push(getFunctionName(reference));
    return { results: [], status: "Exhausted", loadMore: vi.fn() };
  },
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
}));
import SchoolWorkspace from "../app/school/SchoolWorkspace";
import AdminWorkspace from "../app/admin/AdminWorkspace";
import DeliveryGate from "../app/deliveries/DeliveryGate";
import DateLink from "../app/components/DateLink";
import { validDate } from "../app/components/useUrlDate";

beforeEach(() => {
  state.queries = [];
  state.role = "school";
  state.summary = undefined;
});
describe("focused workspace pages", () => {
  it("school overview has no editors or processing actions and only summary subscriptions", () => {
    const html = renderToStaticMarkup(
      createElement(SchoolWorkspace, { page: "Overview" }),
    );
    expect(html).toContain("Serve meals");
    for (const text of [
      "Simulate taps",
      "Roster corrections",
      "Recent notifications",
      "Staff override",
    ])
      expect(html).not.toContain(text);
    expect(state.queries.sort()).toEqual([
      "deliveryDashboard:active",
      "deliveryDashboard:forecasts",
      "deliveryDashboard:forecasts",
      "expectations:daySummary",
    ]);
  });
  it("pupils mounts only the roster query", () => {
    const html = renderToStaticMarkup(
      createElement(SchoolWorkspace, { page: "Pupils" }),
    );
    expect(html).toContain("Add child");
    expect(html).toContain("Mark as left");
    expect(state.queries).toEqual(["readers:activeStudents"]);
  });
  it("communications keeps its date-independent labels and queries", () => {
    const html = renderToStaticMarkup(
      createElement(SchoolWorkspace, { page: "Communications" }),
    );
    expect(html).toContain("SMS spend today");
    expect(state.queries.sort()).toEqual([
      "deliveryNotifications:inbox",
      "notifications:recentForSchool",
      "notifications:spendByRuleToday",
    ]);
  });
  it("tools includes all real-data processing controls", () => {
    const html = renderToStaticMarkup(
      createElement(SchoolWorkspace, { page: "Operations tools" }),
    );
    for (const text of [
      "Run expectations now",
      "Run sweep now",
      "Simulate taps",
      "Run forecast now",
      "Run reconciliation now",
      "real application data",
    ])
      expect(html).toContain(text);
    expect(state.queries).not.toContain("deliveries:listForSchoolDay");
  });
  it("service explains current-day overrides while displaying historical counts", () => {
    const html = renderToStaticMarkup(
      createElement(SchoolWorkspace, { page: "Meal service" }),
    );
    expect(html).toContain("always record a meal for today");
    expect(html).toContain('value="2026-10-20"');
    expect(state.queries).not.toContain("notifications:recentForSchool");
  });
  it("puts service work before counts and explains the recording date before opening the reader", () => {
    state.summary = { fulfilled: 420, pending: 74, missed: 6 };
    const html = renderToStaticMarkup(
      createElement(SchoolWorkspace, { page: "Meal service" }),
    );
    expect(html).toContain("Pilot Primary School");
    expect(html.indexOf("New reader and staff meal records")).toBeLessThan(
      html.indexOf("Open tap reader"),
    );
    expect(html.indexOf("Record meal")).toBeLessThan(
      html.indexOf("Meal service summary"),
    );
    expect(html).not.toContain("/reader?date=2026-10-20");
    expect(html).toContain("View today");
    expect(html).toContain("420");
    expect(html).toContain("500");
  });
  it("puts the overview action before its single served total and keeps unknown counts distinct from zero", () => {
    let html = renderToStaticMarkup(
      createElement(SchoolWorkspace, { page: "Overview" }),
    );
    expect(html).toContain("Loading service counts");
    expect(html).not.toContain("<dd>0</dd>");
    state.summary = { fulfilled: 420, pending: 74, missed: 6 };
    html = renderToStaticMarkup(
      createElement(SchoolWorkspace, { page: "Overview" }),
    );
    expect(html.indexOf("Serve meals")).toBeLessThan(
      html.indexOf("Meal service summary"),
    );
    expect(html.match(/<dd>420<\/dd>/g)).toHaveLength(1);
    state.summary = { fulfilled: 0, pending: 0, missed: 0 };
    html = renderToStaticMarkup(
      createElement(SchoolWorkspace, { page: "Overview" }),
    );
    expect(html).toContain("No meal expectations for this date");
  });
  it("admin overview includes delivery reviews and service metrics", () => {
    state.role = "admin";
    renderToStaticMarkup(createElement(AdminWorkspace, { page: "Overview" }));
    expect(state.queries).toEqual([
      "deliveryDashboard:reviewQueue",
      "deliveryNotifications:inbox",
      "deliveries:listSchools",
      "deliveryDashboard:history",
      "admin:metrics",
    ]);
  });
  it("unauthorized dispatch does not mount its query", () => {
    const html = renderToStaticMarkup(createElement(DeliveryGate));
    expect(html).toContain("cannot access");
    expect(state.queries).toEqual([]);
  });
  it("admin dispatch and payment file destinations remain separate", () => {
    state.role = "admin";
    renderToStaticMarkup(createElement(DeliveryGate));
    expect(state.queries).toEqual(["deliveries:listSchools"]);
    state.queries = [];
    renderToStaticMarkup(createElement(DeliveryGate, { payment: true }));
    expect(state.queries).toEqual(["deliveries:paymentFile"]);
  });
});
it("preserves the service date alongside tag-assignment mode", () => {
  const html = renderToStaticMarkup(
    createElement(DateLink, { href: "/reader?mode=assign" }, "Assign tag"),
  );
  expect(html).toContain("/reader?mode=assign&amp;date=2026-10-20");
});
it("rejects invalid calendar dates before querying", () => {
  expect(validDate("2026-02-30")).toBe(false);
  expect(validDate("2026-02-28")).toBe(true);
  expect(validDate("nonsense")).toBe(false);
  expect(validDate(null)).toBe(false);
});

describe("forecast metric hierarchy", () => {
  it("keeps bias separate from the headline percentage", async () => {
    const { Stat } = await import("../app/components/Stat");
    const html = renderToStaticMarkup(
      createElement(Stat, {
        label: "NRB-PILOT-01 · 6 day(s)",
        value: "±100%",
        detail: "+100% bias",
      }),
    );
    expect(html).toMatch(/stat-value[^>]*>±100%<\/span>/);
    expect(html).toContain(">+100% bias</span>");
    expect(html).toContain("NRB-PILOT-01 · 6 day(s)");
  });
});
