const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€";
const EXTENDED_CHAR_COST = 2;
const GSM7_SINGLE_SEGMENT = 160;
const GSM7_CONCAT_SEGMENT = 153;
const UCS2_SINGLE_SEGMENT = 70;
const UCS2_CONCAT_SEGMENT = 67;

function gsm7Length(text: string): number | null {
  let length = 0;
  for (const char of text) {
    if (GSM7_BASIC.includes(char)) {
      length += 1;
    } else if (GSM7_EXTENDED.includes(char)) {
      length += EXTENDED_CHAR_COST;
    } else {
      return null;
    }
  }
  return length;
}

export function smsSegments(text: string): number {
  const gsmLength = gsm7Length(text);
  if (gsmLength !== null) {
    return gsmLength <= GSM7_SINGLE_SEGMENT ? 1 : Math.ceil(gsmLength / GSM7_CONCAT_SEGMENT);
  }
  const ucs2Length = [...text].length;
  return ucs2Length <= UCS2_SINGLE_SEGMENT ? 1 : Math.ceil(ucs2Length / UCS2_CONCAT_SEGMENT);
}
