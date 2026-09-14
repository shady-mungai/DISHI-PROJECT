import Link from "next/link";

const LINK_CLASS = "rounded border border-zinc-300 px-4 py-3 text-lg hover:bg-zinc-50";

const ROUTES = [
  { href: "/enrolment/import", label: "Enrolment import" },
  { href: "/service-day", label: "Service day" },
  { href: "/reader", label: "Tap reader" },
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 p-4">
      <h1 className="text-2xl font-semibold">Dishi</h1>
      {ROUTES.map((route) => (
        <Link key={route.href} href={route.href} className={LINK_CLASS}>
          {route.label}
        </Link>
      ))}
    </main>
  );
}
