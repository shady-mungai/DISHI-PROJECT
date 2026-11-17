import { createRoot } from "react-dom/client";
import {
  ActiveDeliveries,
  ForecastPanel,
  SupplierDispatch,
} from "../../app/deliveries/DeliveryOperations";
import "../../app/globals.css";
const mode = new URLSearchParams(location.search).get("mode") ?? "school";
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto flex max-w-3xl flex-col gap-6 p-5">
    {mode === "dispatch" ? (
      <SupplierDispatch />
    ) : (
      <>
        <h1 className="text-2xl font-semibold text-green">
          Delivery operations
        </h1>
        <ActiveDeliveries
          role={
            mode === "admin"
              ? "admin"
              : mode === "supplier"
                ? "supplier"
                : "school"
          }
        />
        <ForecastPanel />
      </>
    )}
  </main>,
);
