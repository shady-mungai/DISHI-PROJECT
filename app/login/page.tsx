"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { UserGate, Centered } from "../components/SchoolGate";
import { workspaces } from "../components/Workspace";
import type { Doc } from "@/convex/_generated/dataModel";

function DashboardRedirect({ user }: { user: Doc<"users"> }) {
  const router = useRouter();
  const destination = workspaces(user).includes(user.role)
    ? `/${user.role}`
    : null;
  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);
  return (
    <Centered>
      <main>
        {destination ? (
          <p role="status">
            Opening your workspace…{" "}
            <Link href={destination}>Continue to dashboard</Link>
          </p>
        ) : (
          <>
            <h1 className="text-3xl font-semibold">Your account is ready</h1>
            <p>
              Your account is not attached to a workspace yet. Ask your
              programme administrator to assign access.
            </p>
          </>
        )}
      </main>
    </Centered>
  );
}
export default function Login() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="p-6">
        <Link href="/">← Back to Mlo</Link>
      </header>
      <UserGate>{(user) => <DashboardRedirect user={user} />}</UserGate>
    </div>
  );
}
