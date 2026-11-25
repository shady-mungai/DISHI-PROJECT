"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SchoolGate, Centered } from "@/app/components/SchoolGate";
import Link from "@/app/components/DateLink";
import { useAction, useMutation } from "convex/react";
import type { ChangeEvent } from "react";
import { useState } from "react";
import { PAGE_CLASS, TITLE_CLASS } from "@/app/components/ui";
import { showError } from "@/app/lib/errors";

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
  return (
    <SchoolGate>
      {(schoolId) => <RosterImportFlow schoolId={schoolId} />}
    </SchoolGate>
  );
}

function RosterImportFlow({ schoolId }: { schoolId: Id<"schools"> }) {
  const [rows, setRows] = useState<RosterRowDraft[] | null>(null);
  const [step, setStep] = useState<"upload" | "confirm" | "done">("upload");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{
    studentsCreated: number;
    guardiansCreated: number;
  } | null>(null);

  const requestUploadUrl = useMutation(api.enrolment.requestUploadUrl);
  const parseRosterPdf = useAction(api.enrolment.parsePdf.parseRosterPdf);
  const commitRoster = useMutation(api.enrolment.commitRoster);

  async function handleFileSelected(file: File) {
    setBusy(true);
    try {
      const uploadUrl = await requestUploadUrl();
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error("The PDF could not be uploaded. Please try again.");
      }
      const { storageId } = (await uploadResponse.json()) as {
        storageId: Id<"_storage">;
      };
      const guesses = await parseRosterPdf({ storageId });
      setRows(
        guesses.map((guess) => ({
          fullName: guess.fullName,
          className: guess.className,
          guardianMsisdn: guess.guardianMsisdn,
          guardianRelationship:
            guess.guardianRelationship || BLANK_ROW.guardianRelationship,
          tagUid: guess.tagUid,
          openingBalanceKes: String(guess.openingBalanceKes),
        })),
      );
      setStep("confirm");
    } catch (caught) {
      showError(caught, "Could not read that PDF. Check it is the enrolment list and try again.");
    } finally {
      setBusy(false);
    }
  }

  function updateRow(index: number, patch: Partial<RosterRowDraft>) {
    setRows(
      (current) =>
        current?.map((row, i) => (i === index ? { ...row, ...patch } : row)) ??
        current,
    );
  }

  function removeRow(index: number) {
    setRows((current) => current?.filter((_, i) => i !== index) ?? current);
  }

  function addRow() {
    setRows((current) => [...(current ?? []), { ...BLANK_ROW }]);
  }

  const rowErrors = (rows ?? []).map((row) =>
    !row.fullName.trim() || !row.className.trim()
      ? "Enter a full name and class."
      : !/^(?:\+?254|0)[17]\d{8}$/.test(row.guardianMsisdn.replace(/\s/g, ""))
        ? "Enter a valid Kenyan guardian phone number."
        : !Number.isFinite(Number(row.openingBalanceKes))
          ? "Enter a numeric opening balance."
          : "",
  );

  async function handleConfirm() {
    if (!rows || rowErrors.some(Boolean)) {
      return;
    }
    setBusy(true);
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
      showError(caught, "Could not save the roster. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "upload") {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-3 text-center">
          <p>1. Upload → 2. Review → 3. Confirm</p>
          <h1 className={TITLE_CLASS}>Upload the enrolment PDF</h1>
          <label htmlFor="roster-file">Enrolment PDF</label>
          <input
            id="roster-file"
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
          {busy && <p className="text-sm text-ink/80">Reading the PDF…</p>}
        </div>
      </Centered>
    );
  }

  if (step === "done") {
    return (
      <Centered>
        <div role="status">
          <h1 className={TITLE_CLASS}>Roster saved</h1>
          <p>
            Created: {summary?.studentsCreated} students,{" "}
            {summary?.guardiansCreated} guardians.
          </p>
          <Link href="/school/pupils">Return to pupils</Link>
        </div>
      </Centered>
    );
  }

  return (
    <div className={PAGE_CLASS}>
      <h1 className={TITLE_CLASS}>Review the roster</h1>
      <p>
        1. Upload → <strong>2. Review</strong> → 3. Confirm
      </p>
      <p className="text-sm text-ink/80">
        Check every name the parser guessed, and fill in each guardian&apos;s
        phone number.
      </p>
      <div className="overflow-x-auto">
        <table className="record-table import-table">
          <thead>
            <tr className="text-left text-ink/80">
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
              <tr key={index} className="border-t border-green/20">
                <td className="p-1">
                  <RowInput
                    label="Full name"
                    value={row.fullName}
                    onChange={(value) => updateRow(index, { fullName: value })}
                  />
                </td>
                <td className="p-1">
                  <RowInput
                    label="Class"
                    value={row.className}
                    onChange={(value) => updateRow(index, { className: value })}
                  />
                </td>
                <td className="p-1">
                  <RowInput
                    label="Guardian phone"
                    value={row.guardianMsisdn}
                    placeholder="+2547…"
                    onChange={(value) =>
                      updateRow(index, { guardianMsisdn: value })
                    }
                  />
                </td>
                <td className="p-1">
                  <RowInput
                    label="Relationship"
                    value={row.guardianRelationship}
                    onChange={(value) =>
                      updateRow(index, { guardianRelationship: value })
                    }
                  />
                </td>
                <td className="p-1">
                  <RowInput
                    label="Tag UID"
                    value={row.tagUid}
                    onChange={(value) => updateRow(index, { tagUid: value })}
                  />
                </td>
                <td className="p-1">
                  <RowInput
                    label="Opening balance (KES)"
                    value={row.openingBalanceKes}
                    onChange={(value) =>
                      updateRow(index, { openingBalanceKes: value })
                    }
                  />
                </td>
                <td className="p-1">
                  {rowErrors[index] && (
                    <p role="alert" className="text-error">
                      Row {index + 1}: {rowErrors[index]}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="text-ink/80 hover:text-error"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={addRow}
          className="rounded border border-green px-3 py-1.5 text-sm"
        >
          Add row
        </button>
        <button
          type="button"
          disabled={busy || !rows?.length || rowErrors.some(Boolean)}
          onClick={handleConfirm}
          className="rounded bg-green px-3 py-1.5 text-sm text-cream disabled:opacity-50"
        >
          Confirm roster ({rows?.length ?? 0})
        </button>
      </div>
    </div>
  );
}

function RowInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onChange(event.target.value)
        }
        className="min-h-11 w-full rounded-control border-2 border-green px-2 py-1"
      />
    </label>
  );
}
