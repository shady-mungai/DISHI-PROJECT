"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";
export default function DateLink({
  href,
  ...props
}: ComponentProps<typeof Link>) {
  const params = useSearchParams();
  if (typeof href !== "string" || !href.startsWith("/"))
    return <Link href={href} {...props} />;
  const [path, query] = href.split("?");
  const next = new URLSearchParams(query);
  for (const key of ["date", "from", "to"]) {
    const value = params.get(key);
    if (value && !next.has(key)) next.set(key, value);
  }
  return <Link href={`${path}${next.size ? `?${next}` : ""}`} {...props} />;
}
