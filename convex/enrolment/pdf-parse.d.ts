// pdf-parse@1.x ships no types. Minimal shape for the one call we make.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfTextItem {
    str: string;
    transform: number[];
  }
  interface PdfPageData {
    getTextContent(): Promise<{ items: PdfTextItem[] }>;
  }
  interface PdfParseOptions {
    pagerender?: (pageData: PdfPageData) => Promise<string>;
  }
  interface PdfParseResult {
    text: string;
  }
  export default function pdfParse(data: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;
}
