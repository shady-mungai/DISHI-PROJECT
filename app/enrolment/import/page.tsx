"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { authClient } from "@/app/auth-client";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

type RosterRowDraft = {
  fullName: string;
  className: string;
  guardianMsisdn: string;
  guardianRelationship: string;
  tagUid: string;
  openingBalanceKes: string;
};

const BLANK_ROW: RosterRowDraft = {
  fullName: "",
  className: "",
  guardianMsisdn: "",
  guardianRelationship: "guardian",
  tagUid: "",
  openingBalanceKes: "0",
};

export default function EnrolmentImportPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return <Centered>Loading…</Centered>;
  }
  if (!isAuthenticated) {
    return <SignInForm />;
  }
  return <RosterImport />;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-8 text-zinc-500">{children}</div>;
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
          className="rounded border border-zinc-300 px-3 py-2"
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
          className="rounded border border-zinc-300 px-3 py-2"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={pending} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">
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

// ponytail: every self-serve signup lands here with a "school" profile on the
// single pilot school (see convex/users.ts#bootstrapProfile). Fine for a
// one-school pilot; add real role assignment before a second actor type signs in.
function RosterImport() {
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

  return <RosterImportFlow schoolId={profile.schoolId} />;
}

function RosterImportFlow({ schoolId }: { schoolId: Id<"schools"> }) {
  const [rows, setRows] = useState<RosterRowDraft[] | null>(null);
  const [step, setStep] = useState<"upload" | "confirm" | "done">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ studentsCreated: number; guardiansCreated: number } | null>(null);

  const requestUploadUrl = useMutation(api.enrolment.requestUploadUrl);
  const parseRosterPdf = useAction(api.enrolment.parsePdf.parseRosterPdf);
  const commitRoster = useMutation(api.enrolment.commitRoster);

  async function handleFileSelected(file: File) {
    setBusy(true);
    setError(null);
    try {
      const uploadUrl = await requestUploadUrl();
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error("Upload failed");
      }
      const { storageId } = (await uploadResponse.json()) as { storageId: Id<"_storage"> };
      const guesses = await parseRosterPdf({ storageId });
      setRows(
        guesses.map((guess) => ({
          fullName: guess.fullName,
          className: guess.className,
          guardianMsisdn: guess.guardianMsisdn,
          guardianRelationship: guess.guardianRelationship || BLANK_ROW.guardianRelationship,
          tagUid: guess.tagUid,
          openingBalanceKes: String(guess.openingBalanceKes),
        })),
      );
      setStep("confirm");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read that PDF");
    } finally {
      setBusy(false);
    }
  }

  function updateRow(index: number, patch: Partial<RosterRowDraft>) {
    setRows((current) => current?.map((row, i) => (i === index ? { ...row, ...patch } : row)) ?? current);
  }

  function removeRow(index: number) {
    setRows((current) => current?.filter((_, i) => i !== index) ?? current);
  }

  function addRow() {
    setRows((current) => [...(current ?? []), { ...BLANK_ROW }]);
  }

  async function handleConfirm() {
    if (!rows) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await commitRoster({
        schoolId,
        rows: rows.map((row) => ({
          fullName: row.fullName,
          className: row.className,
          guardianMsisdn: row.guardianMsisdn,
          guardianRelationship: row.guardianRelationship,
          tagUid: row.tagUid || undefined,
          openingBalanceKes: Number(row.openingBalanceKes) || 0,
        })),
      });
      setSummary(result);
      setStep("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the roster");
    } finally {
      setBusy(false);
    }
  }

  if (step === "upload") {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-lg font-semibold">Upload the enrolment PDF</h1>
          <input
            type="file"
            accept="application/pdf"
            disabled={busy}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleFileSelected(file);
              }
            }}
          />
          {busy && <p className="text-sm text-zinc-500">Reading the PDF…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </Centered>
    );
  }

  if (step === "done") {
    return (
      <Centered>
        <p>
          Roster saved: {summary?.studentsCreated} students, {summary?.guardiansCreated} guardians.
        </p>
      </Centered>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-8">
      <h1 className="text-lg font-semibold">Confirm the roster</h1>
      <p className="text-sm text-zinc-500">
        Check every name the parser guessed, and fill in each guardian&apos;s phone number.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="p-2">Full name</th>
              <th className="p-2">Class</th>
              <th className="p-2">Guardian phone</th>
              <th className="p-2">Relationship</th>
              <th className="p-2">Tag UID</th>
              <th className="p-2">Opening balance (KES)</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows?.map((row, index) => (
              <tr key={index} className="border-t border-zinc-200">
                <td className="p-1">
                  <RowInput value={row.fullName} onChange={(value) => updateRow(index, { fullName: value })} />
                </td>
                <td className="p-1">
                  <RowInput value={row.className} onChange={(value) => updateRow(index, { className: value })} />
                </td>
                <td className="p-1">
                  <RowInput
                    value={row.guardianMsisdn}
                    placeholder="+2547…"
                    onChange={(value) => updateRow(index, { guardianMsisdn: value })}
                  />
                </td>
                <td className="p-1">
                  <RowInput
                    value={row.guardianRelationship}
                    onChange={(value) => updateRow(index, { guardianRelationship: value })}
                  />
                </td>
                <td className="p-1">
                  <RowInput value={row.tagUid} onChange={(value) => updateRow(index, { tagUid: value })} />
                </td>
                <td className="p-1">
                  <RowInput
                    value={row.openingBalanceKes}
                    onChange={(value) => updateRow(index, { openingBalanceKes: value })}
                  />
                </td>
                <td className="p-1">
                  <button type="button" onClick={() => removeRow(index)} className="text-zinc-400 hover:text-red-600">
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={addRow} className="rounded border border-zinc-300 px-3 py-1.5 text-sm">
          Add row
        </button>
        <button
          type="button"
          disabled={busy || !rows?.length}
          onClick={handleConfirm}
          className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Confirm roster ({rows?.length ?? 0})
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}

function RowInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      className="w-full rounded border border-zinc-200 px-2 py-1"
    />
  );
}
