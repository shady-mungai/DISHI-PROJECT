"use client";
import Link from "@/app/components/DateLink";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, useRef, type ReactNode } from "react";
import { UserGate } from "./SchoolGate";
import { authClient } from "../auth-client";
import type { Doc } from "@/convex/_generated/dataModel";
export const destinations = {
  school: [
    ["", "Overview"],
    ["/service", "Meal service"],
    ["/pupils", "Pupils"],
    ["/deliveries", "Deliveries"],
    ["/readers", "Readers"],
    ["/communications", "Communications"],
    ["/tools", "Operations tools"],
  ],
  supplier: [
    ["", "Overview"],
    ["/dispatch", "Declare dispatch"],
    ["/reconciliation", "Reconciliation"],
    ["/accuracy", "Forecast accuracy"],
  ],
  county: [
    ["", "Overview"],
    ["/schools", "Schools"],
    ["/payment-files", "Payment files"],
  ],
  admin: [
    ["", "Overview"],
    ["/communications", "Communications and spend"],
    ["/devices", "Device fleet"],
    ["/rules", "Notification rules"],
    ["/trace", "Message tracing"],
    ["/audit", "Audit history"],
    ["/settings", "Settings and retention"],
    ["/dispatch", "Declare dispatch"],
    ["/payment-files", "Payment files"],
  ],
} as const;
export function workspaces(user: Pick<Doc<"users">, "role" | "schoolId">) {
  return [
    ...(user.schoolId && ["school", "county", "admin"].includes(user.role)
      ? ["school" as const]
      : []),
    ...(["supplier", "county", "admin"].includes(user.role)
      ? ["supplier" as const]
      : []),
    ...(["county", "admin"].includes(user.role) ? ["county" as const] : []),
    ...(user.role === "admin" ? ["admin" as const] : []),
  ];
}
export function Workspace({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path === "/" || path === "/login") return children;
  return <UserGate>{(user) => <Shell user={user}>{children}</Shell>}</UserGate>;
}
function Shell({
  user,
  children,
}: {
  user: Doc<"users">;
  children: ReactNode;
}) {
  const path = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const available = workspaces(user);
  const segment = path.split("/")[1];
  const workspace = (
    segment in destinations ? segment : "school"
  ) as keyof typeof destinations;
  const query = new URLSearchParams();
  for (const key of ["date", "from", "to"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const suffix = query.size ? `?${query}` : "";
  const showServiceShortcut =
    workspace === "school" &&
    user.schoolId &&
    !["/school", "/school/service", "/reader"].includes(path);
  return (
    <div
      className="app-shell"
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          setOpen(false);
          menuButton.current?.focus();
        }
      }}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="mobile-header">
        <Link
          href="/"
          className="workspace-brand font-semibold text-2xl"
          aria-label="Mlo home"
        >
          <span aria-hidden="true">◒</span> mlo.
        </Link>
        <button
          ref={menuButton}
          aria-expanded={open}
          aria-controls="workspace-nav"
          onClick={() => setOpen(!open)}
        >
          {" "}
          {open ? "Close navigation" : "Open navigation"}
        </button>
        {showServiceShortcut && (
          <Link className="serve-shortcut" href={`/school/service${suffix}`}>
            Serve meals
          </Link>
        )}
      </header>
      <aside className={open ? "sidebar is-open" : "sidebar"}>
        <Link
          href="/"
          className="workspace-brand text-3xl font-semibold"
          aria-label="Mlo home"
        >
          <span aria-hidden="true">◒</span> mlo.
        </Link>
        <p className="workspace-label capitalize">{workspace} workspace</p>
        <nav id="workspace-nav" aria-label="Workspace navigation">
          {available.includes(workspace) &&
            destinations[workspace].map(([route, label]) => (
              <Link
                key={route}
                href={`/${workspace}${route}${suffix}`}
                aria-current={
                  path === `/${workspace}${route}` ? "page" : undefined
                }
                onClick={() => setOpen(false)}
              >
                {label}
              </Link>
            ))}
        </nav>
        <nav className="workspace-switcher" aria-label="Switch workspace">
          {available.map((item) => (
            <Link
              key={item}
              href={`/${item}${suffix}`}
              onClick={() => setOpen(false)}
            >
              Open {item}
            </Link>
          ))}
        </nav>
        <p className="workspace-account">
          <span className="workspace-account-label">Signed in as</span>
          {user.displayName}
        </p>
        <button onClick={() => void authClient.signOut()}>Sign out</button>
      </aside>
      <main id="main-content" tabIndex={-1} className="workspace-main">
        <div className="workspace-context">
          <span className="capitalize">{workspace} workspace</span>
          <span className="workspace-motto">Good food. Every school day.</span>
        </div>
        {children}
      </main>
    </div>
  );
}
