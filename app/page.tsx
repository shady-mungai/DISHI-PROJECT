import Link from "next/link";
import { NARROW_PAGE_CLASS } from "@/app/components/ui";

const NAV_LINK_CLASS =
  "flex min-h-14 items-center rounded-control border-2 border-green bg-cream-light px-4 text-lg font-medium text-green no-underline hover:bg-green hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber";

const ROUTES = [
  { href: "/service-day", label: "School dashboard" },
  { href: "/reader", label: "Tap reader" },
  { href: "/deliveries", label: "Deliveries" },
  { href: "/supplier", label: "Supplier dashboard" },
  { href: "/county", label: "County dashboard" },
  { href: "/enrolment/import", label: "Enrolment import" },
  { href: "/admin", label: "Admin console" },
] as const;

export default function Home() {
  return (
    <main className={NARROW_PAGE_CLASS}>
      <header className="rounded-panel bg-green p-6 text-cream">
        <p className="text-sm font-medium uppercase tracking-wide text-amber">School feeding platform</p>
        <h1 className="text-4xl font-semibold">Dishi</h1>
        <p className="mt-2 text-cream/80">Every meal counted. Every guardian told.</p>
      </header>
      <nav className="flex flex-col gap-3">
        {ROUTES.map((route) => (
          <Link key={route.href} href={route.href} className={NAV_LINK_CLASS}>
            {route.label}
          </Link>
        ))}
      </nav>
    </main>
  );
}
