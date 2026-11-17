"use client";
import { UserGate, Centered } from "../components/SchoolGate";
import { SupplierPanel, PaymentFilePanel } from "./DeliveryWorkflows";
export default function DeliveryGate({
  payment = false,
}: {
  payment?: boolean;
}) {
  return (
    <UserGate>
      {(user) =>
        (payment ? ["county", "admin"] : ["supplier", "admin"]).includes(
          user.role,
        ) ? (
          payment ? (
            <PaymentFilePanel />
          ) : (
            <SupplierPanel />
          )
        ) : (
          <Centered>Your account cannot access this workflow.</Centered>
        )
      }
    </UserGate>
  );
}
