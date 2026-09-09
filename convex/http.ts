import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { internal } from "./_generated/api";
import { hmacSha256Hex, timingSafeEqualHex } from "./lib/hmac";
import { MAX_INGEST_BATCH_EVENTS, parseIngestBody } from "./ingest";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/ingest",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const deviceRef = req.headers.get("X-Device-Ref");
    const signature = req.headers.get("X-Signature");
    if (!deviceRef || !signature) {
      return Response.json({ error: "missing_auth_headers" }, { status: 401 });
    }

    const device = await ctx.runQuery(internal.ingest.getDeviceSecretHash, { deviceRef });
    if (!device) {
      return Response.json({ error: "unknown_device" }, { status: 401 });
    }

    const bodyBytes = new Uint8Array(await req.arrayBuffer());
    const expectedSignature = await hmacSha256Hex(device.secretHash, bodyBytes);
    if (!timingSafeEqualHex(signature.toLowerCase(), expectedSignature)) {
      return Response.json({ error: "invalid_signature" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }

    const events = parseIngestBody(body);
    if (!events || events.length === 0 || events.length > MAX_INGEST_BATCH_EVENTS) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }

    const results = await ctx.runMutation(internal.ingest.recordBatch, { deviceRef, events });
    return Response.json({ results }, { status: 200 });
  }),
});

export default http;
