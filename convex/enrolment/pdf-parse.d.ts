// pdf-parse@1.x ships no types. Minimal shape for the one call we make.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
  }
  export default function pdfParse(data: Buffer): Promise<PdfParseResult>;
}
