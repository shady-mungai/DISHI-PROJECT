"use client";

import { useEffect, useState } from "react";
import { ERROR_TOAST_EVENT } from "@/app/lib/errors";

const VISIBLE_MS = 1500;
const OVERLAY_CLASS = "pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4";
const TOAST_CLASS = "max-w-md rounded-control bg-error px-4 py-2 text-sm font-medium text-on-primary shadow-lg";

type Toast = { id: number; message: string };

function useErrorToast(): Toast | null {
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

  return toast;
}

export function ErrorToaster() {
  const toast = useErrorToast();
  if (!toast) return null;
  return (
    <div className={OVERLAY_CLASS}>
      <p key={toast.id} role="alert" className={TOAST_CLASS}>
        {toast.message}
      </p>
    </div>
  );
}
