"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
export function validDate(value: string | null): value is string {
  return (
    !!value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function useUrlDate(
  key: string,
  fallback: () => string,
): [string, (value: string) => void] {
  const [initial] = useState(fallback);
  const params = useSearchParams();
  const raw = params.get(key);
  return [
    validDate(raw) ? raw : initial,
    (value) => {
      if (!validDate(value)) return;
      const next = new URL(window.location.href);
      next.searchParams.set(key, value);
      window.history.pushState(null, "", next);
    },
  ];
}
