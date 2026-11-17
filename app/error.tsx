"use client";
import { BUTTON_CLASS, PAGE_CLASS, TITLE_CLASS } from "./components/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className={PAGE_CLASS}>
      <h1 className={TITLE_CLASS}>We couldn’t load this page</h1>
      <p role="alert">
        Check your connection and try again. If this continues, check that your
        account has access to this workspace.
      </p>
      <button className={BUTTON_CLASS} onClick={reset}>
        Try again
      </button>
    </div>
  );
}
