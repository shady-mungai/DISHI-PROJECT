const VISIBLE_SUFFIX_LENGTH = 3;

export function maskMsisdn(msisdn: string): string {
  const suffix = msisdn.slice(-VISIBLE_SUFFIX_LENGTH);
  return `${"*".repeat(Math.max(0, msisdn.length - VISIBLE_SUFFIX_LENGTH))}${suffix}`;
}
