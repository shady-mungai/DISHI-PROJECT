"use node";

import { v } from "convex/values";
// Import the inner module directly, not the package's `index.js` — that
// entry point runs a self-test against a bundled sample PDF whenever
// `module.parent` is falsy, which is exactly how Convex's bundler loads it.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { parseRosterText } from "../lib/enrolmentParser";

export const parseRosterPdf = action({
  args: { storageId: v.id("_storage") },
  returns: v.array(v.object({ rawLine: v.string(), fullName: v.string(), className: v.string() })),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.enrolment.assertImportRole, {});

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      throw new Error("Enrolment PDF not found in storage");
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const { text } = await pdfParse(buffer);
    return parseRosterText(text);
  },
});
