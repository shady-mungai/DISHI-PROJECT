// Shared by the dispatch mutation and the supplier's live calculator, so the
// number on screen is the number recorded. No server imports: the browser loads it.
export const DEFAULT_PORTION_GRAMS = 350;

// Whole grams first, so 4.55 kg is 4550 g, not 4549.999…, then whole portions only.
export function portionsFromKg(kg: number, gramsPerPortion: number) {
  return Math.floor(Math.round(kg * 1000) / gramsPerPortion);
}
