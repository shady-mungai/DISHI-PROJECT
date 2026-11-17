"use client";
import { UserGate } from "../components/SchoolGate";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
function Redirect({ role }: { role: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const route =
    role === "admin"
      ? "/admin/dispatch"
      : role === "supplier"
        ? "/supplier/dispatch"
        : role === "county"
          ? "/county/payment-files"
          : "/school/deliveries";
  useEffect(() => {
    router.replace(`${route}?${params}`);
  }, [router, route, params]);
  return <p role="status">Opening deliveries…</p>;
}
export default function Page() {
  return <UserGate>{(user) => <Redirect role={user.role} />}</UserGate>;
}
