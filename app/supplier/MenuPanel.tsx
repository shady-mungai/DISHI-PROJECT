"use client";

import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { showError } from "@/app/lib/errors";
import { BUTTON_CLASS, INPUT_CLASS, MUTED_CLASS, SECONDARY_BUTTON_CLASS, SECTION_TITLE_CLASS } from "@/app/components/ui";

export function MenuPanel({ role }: { role: "supplier" | "admin" | "county" }) {
  const menu = useQuery(api.supplier.menu, {});
  const add = useMutation(api.supplier.addMenuItem);
  const setActive = useMutation(api.supplier.setMenuItemActive);
  const [dish, setDish] = useState("");
  const canEdit = role !== "county";
  if (!menu) return <p role="status">Loading menu…</p>;
  const active = menu.filter((item) => item.active);
  const retired = menu.filter((item) => !item.active);

  return (
    <>
      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            add({ dish })
              .then(() => setDish(""))
              .catch((caught) => showError(caught, "Dish not added. Try again."));
          }}
        >
          <label className="flex flex-col gap-1">
            Add a dish
            <input required maxLength={60} placeholder="e.g. githeri" value={dish} onChange={(e) => setDish(e.target.value)} className={INPUT_CLASS} />
          </label>
          <button className={BUTTON_CLASS}>Add to menu</button>
        </form>
      )}

      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>Rotation, next to serve first</h2>
        {active.length === 0 && <p className={MUTED_CLASS}>No dishes on the menu yet. Dispatches need a dish from this list.</p>}
        <table className="record-table">
          <caption className="sr-only">Active menu in rotation order</caption>
          <thead>
            <tr>
              <th scope="col">Dish</th>
              <th scope="col">Last served</th>
              <th scope="col">Days served, last 90</th>
              {canEdit && <th scope="col">Action</th>}
            </tr>
          </thead>
          <tbody>
            {[...active, ...retired].map((item, index) => (
              <tr key={item._id} className={item.active ? "" : "text-muted"}>
                <td data-label="Dish" className="font-sans">
                  {item.dish}
                  {item.active && index === 0 && " — next in rotation"}
                  {!item.active && " (retired)"}
                </td>
                <td data-label="Last served">{item.lastServed ?? "Not yet"}</td>
                <td data-label="Days served, last 90">{item.timesServed}</td>
                {canEdit && (
                  <td data-label="Action">
                    <button
                      className={SECONDARY_BUTTON_CLASS}
                      onClick={() =>
                        setActive({ menuItemId: item._id, active: !item.active }).catch((caught) => showError(caught, "Menu not changed. Try again."))
                      }
                    >
                      {item.active ? "Retire" : "Restore"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className={MUTED_CLASS}>
        Every dispatch serves one dish from this menu, and the dispatch form
        suggests the dish that has gone longest without being served at that
        school. Rotating dishes across weekdays lets the insights page compare
        what children eat, skip and leave over.
      </p>
    </>
  );
}
