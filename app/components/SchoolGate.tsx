"use client";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { authClient } from "@/app/auth-client";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { BUTTON_CLASS, INPUT_CLASS, TITLE_CLASS } from "@/app/components/ui";

export function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-ink/80">
      {children}
    </div>
  );
}

// Renders `children(user)` only once the viewer is signed in and has a profile.
export function UserGate({
  children,
}: {
  children: (user: Doc<"users">) => ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return <Centered>Loading…</Centered>;
  }
  if (!isAuthenticated) {
    return <SignInForm />;
  }
  return <ProfileGate>{children}</ProfileGate>;
}

// Renders `children(schoolId)` only for a school-scoped profile. Same gate the
// enrolment page carries inline.
export function SchoolGate({
  children,
}: {
  children: (schoolId: Id<"schools">) => ReactNode;
}) {
  return (
    <UserGate>
      {(user) =>
        user.schoolId && ["school", "county", "admin"].includes(user.role) ? (
          children(user.schoolId)
        ) : (
          <Centered>Your account isn&apos;t attached to a school yet.</Centered>
        )
      }
    </UserGate>
  );
}

function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result =
        mode === "sign-in"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name: email });
      if (result.error) {
        setError(result.error.message ?? "Something went wrong");
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not reach the server",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Centered>
      <main className="auth-panel w-full max-w-sm">
        <p className="mb-4 text-3xl font-semibold text-green">Mlo</p>
        <p className="mb-6">Every meal counted. Every guardian told.</p>
        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-sm flex-col gap-3"
        >
          <h1 className={TITLE_CLASS}>
            {mode === "sign-in" ? "Sign in" : "Create an account"}
          </h1>
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            autoComplete="email"
            type="email"
            required
            aria-label="Email"
            placeholder="Email"
            value={email}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setEmail(event.target.value)
            }
            className={INPUT_CLASS}
          />
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            autoComplete={
              mode === "sign-in" ? "current-password" : "new-password"
            }
            type="password"
            required
            aria-label="Password"
            placeholder="Password"
            value={password}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setPassword(event.target.value)
            }
            className={INPUT_CLASS}
          />
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <button type="submit" disabled={pending} className={BUTTON_CLASS}>
            {pending
              ? "Please wait…"
              : mode === "sign-in"
                ? "Sign in"
                : "Sign up"}
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
            className="text-sm text-ink/80 underline"
          >
            {mode === "sign-in"
              ? "Need an account? Sign up"
              : "Have an account? Sign in"}
          </button>
        </form>
      </main>
    </Centered>
  );
}

function ProfileGate({
  children,
}: {
  children: (user: Doc<"users">) => ReactNode;
}) {
  const profile = useQuery(api.users.me);
  const bootstrapProfile = useMutation(api.users.bootstrapProfile);
  const bootstrapped = useRef(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    if (profile === null && !bootstrapped.current) {
      bootstrapped.current = true;
      bootstrapProfile({ displayName: "School staff" }).catch(
        (caught: unknown) => {
          setBootstrapError(
            caught instanceof Error
              ? caught.message
              : "Could not set up your account",
          );
        },
      );
    }
  }, [profile, bootstrapProfile]);

  if (bootstrapError) {
    return <Centered>{bootstrapError}</Centered>;
  }
  if (profile === undefined || profile === null) {
    return <Centered>Setting up your account…</Centered>;
  }
  return <>{children(profile)}</>;
}
