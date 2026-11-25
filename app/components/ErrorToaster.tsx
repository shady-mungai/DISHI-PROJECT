"use client";

import { useEffect, useState } from "react";
import { ERROR_TOAST_EVENT } from "@/app/lib/errors";

const VISIBLE_MS = 6000;
const OVERLAY_CLASS = "pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4";
const TOAST_CLASS =
  "pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-control border-2 border-error bg-error px-5 py-4 text-on-primary shadow-lg";
const DISMISS_CLASS = "min-h-11 shrink-0 rounded-control px-2 font-semibold underline focus-visible:outline-2 focus-visible:outline-on-primary";

type Toast = { id: number; message: string };

function useErrorToast(): [Toast | null, () => void] {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    function onError(event: Event) {
      setToast({ id: Date.now(), message: (event as CustomEvent<string>).detail });
    }
    window.addEventListener(ERROR_TOAST_EVENT, onError);
    return () => window.removeEventListener(ERROR_TOAST_EVENT, onError);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return [toast, () => setToast(null)];
}

export function ErrorToaster() {
  const [toast, dismiss] = useErrorToast();
  if (!toast) return null;
  return (
    <div className={OVERLAY_CLASS}>
      <div key={toast.id} role="alert" className={TOAST_CLASS}>
        <p className="flex-1 font-medium">{toast.message}</p>
        <button type="button" onClick={dismiss} className={DISMISS_CLASS}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
