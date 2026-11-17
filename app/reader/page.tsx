"use client";

import type { Id } from "@/convex/_generated/dataModel";
import { Centered, SchoolGate } from "@/app/components/SchoolGate";
import dynamic from "next/dynamic";

// The panel reads localStorage and Web NFC in render-time initialisers, so it
// is never server-rendered.
const ReaderPanel = dynamic(() => import("./ReaderPanel"), {
  ssr: false,
  loading: () => <Centered>Loading reader…</Centered>,
});

export default function ReaderPage() {
  return (
    <SchoolGate>
      {(schoolId: Id<"schools">) => <ReaderPanel schoolId={schoolId} />}
    </SchoolGate>
  );
}
