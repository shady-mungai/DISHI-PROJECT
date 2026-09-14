// Web NFC reports `serialNumber` as lowercase colon-separated hex; the PDF
// column may arrive in any case. One canonical form at every write and lookup.
export function normaliseTagUid(tagUid: string): string {
  return tagUid.trim().toLowerCase();
}
