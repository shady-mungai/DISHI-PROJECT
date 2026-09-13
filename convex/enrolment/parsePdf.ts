"use node";

import { v } from "convex/values";
// Import the inner module directly, not the package's `index.js` — that
// entry point runs a self-test against a bundled sample PDF whenever
// `module.parent` is falsy, which is exactly how Convex's bundler loads it.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type { PdfPageData } from "pdf-parse/lib/pdf-parse.js";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { parseRosterText } from "../lib/enrolmentParser";

const TRANSFORM_Y_INDEX = 5;
const COLUMN_SEPARATOR = "\t";

// pdf-parse's default renderer glues every text item on a line together with
// no separator, so table cells fuse ("1Elvis MutuaPP1…"). Emit one tab per
// item instead so the roster parser can split columns.
async function renderPageAsTabbedLines(pageData: PdfPageData): Promise<string> {
  const { items } = await pageData.getTextContent();
  const lines: string[][] = [];
  let lastY: number | undefined;
  for (const item of items) {
    const y = item.transform[TRANSFORM_Y_INDEX];
    if (y !== lastY) {
      lines.push([]);
    }
    lines[lines.length - 1].push(item.str);
    lastY = y;
  }
  return lines.map((cells) => cells.join(COLUMN_SEPARATOR)).join("\n");
}

export const parseRosterPdf = action({
  args: { storageId: v.id("_storage") },
  returns: v.array(
    v.object({
      rawLine: v.string(),
      fullName: v.string(),
      className: v.string(),
      guardianMsisdn: v.string(),
      guardianRelationship: v.string(),
      tagUid: v.string(),
      openingBalanceKes: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.enrolment.assertImportRole, {});

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      throw new Error("Enrolment PDF not found in storage");
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const { text } = await pdfParse(buffer, { pagerender: renderPageAsTabbedLines });
    return parseRosterText(text);
  },
});
