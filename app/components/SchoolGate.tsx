"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { authClient } from "@/app/auth-client";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

const INPUT_CLASS = "rounded border border-zinc-300 px-3 py-2";
const PRIMARY_BUTTON_CLASS = "rounded bg-black px-3 py-2 text-white disabled:opacity-50";

export function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-8 text-zinc-500">{children}</div>;
}

// Renders `children(schoolId)` only once the viewer is signed in and has a
// school-scoped profile. Same gate the enrolment page carries inline.
export function SchoolGate({ children }: { children: (schoolId: Id<"schools">) => ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return <Centered>Loading…</Centered>;
  }
  if (!isAuthenticated) {
    return <SignInForm />;
  }
  return <ProfileGate>{children}</ProfileGate>;
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
      setError(caught instanceof Error ? caught.message : "Could not reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <Centered>
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3">
        <h1 className="text-lg font-semibold">{mode === "sign-in" ? "Sign in" : "Create an account"}</h1>
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
          className={INPUT_CLASS}
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
          className={INPUT_CLASS}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON_CLASS}>
          {mode === "sign-in" ? "Sign in" : "Sign up"}
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
          className="text-sm text-zinc-500 underline"
        >
          {mode === "sign-in" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </Centered>
  );
}

function ProfileGate({ children }: { children: (schoolId: Id<"schools">) => ReactNode }) {
  const profile = useQuery(api.users.me);
  const bootstrapProfile = useMutation(api.users.bootstrapProfile);
  const bootstrapped = useRef(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    if (profile === null && !bootstrapped.current) {
      bootstrapped.current = true;
      bootstrapProfile({ displayName: "School staff" }).catch((caught: unknown) => {
        setBootstrapError(caught instanceof Error ? caught.message : "Could not set up your account");
      });
    }
  }, [profile, bootstrapProfile]);

  if (bootstrapError) {
    return <Centered>{bootstrapError}</Centered>;
  }
  if (profile === undefined || profile === null) {
    return <Centered>Setting up your account…</Centered>;
  }
  if (!profile.schoolId) {
    return <Centered>Your account isn&apos;t attached to a school yet.</Centered>;
  }
  return <>{children(profile.schoolId)}</>;
}
