import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { internal } from "./_generated/api";
import { hmacSha256Hex, timingSafeEqualHex } from "./lib/hmac";
import { bodyToRecord, parseDeliveryReport } from "./lib/deliveryReport";
import { MAX_INGEST_BATCH_EVENTS, parseIngestBody } from "./ingest";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

// Browser readers (the PWA) call /ingest cross-origin. The endpoint is
// HMAC-authenticated and cookie-free, so any origin may attempt it.
const INGEST_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Ref, X-Signature",
  "Access-Control-Max-Age": "86400",
};

function ingestJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: INGEST_CORS_HEADERS });
}

http.route({
  path: "/ingest",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: INGEST_CORS_HEADERS })),
});

http.route({
  path: "/ingest",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const deviceRef = req.headers.get("X-Device-Ref");
    const signature = req.headers.get("X-Signature");
    if (!deviceRef || !signature) {
      return ingestJson({ error: "missing_auth_headers" }, 401);
    }

    const device = await ctx.runQuery(internal.ingest.getDeviceSecretHash, { deviceRef });
    if (!device) {
      return ingestJson({ error: "unknown_device" }, 401);
    }

    const bodyBytes = new Uint8Array(await req.arrayBuffer());
    const expectedSignature = await hmacSha256Hex(device.secretHash, bodyBytes);
    if (!timingSafeEqualHex(signature.toLowerCase(), expectedSignature)) {
      return ingestJson({ error: "invalid_signature" }, 401);
    }

    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      return ingestJson({ error: "invalid_json" }, 400);
    }

    const events = parseIngestBody(body);
    if (!events || events.length === 0 || events.length > MAX_INGEST_BATCH_EVENTS) {
      return ingestJson({ error: "invalid_body" }, 400);
    }

    const results = await ctx.runMutation(internal.ingest.recordBatch, { deviceRef, events });
    return ingestJson({ results }, 200);
  }),
});

// Gateway callbacks carry no signature; the shared token in the query string
// is the only thing stopping anyone from marking messages delivered.
http.route({
  path: "/dlr",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const token = new URL(req.url).searchParams.get("token");
    const expectedToken = process.env.DLR_TOKEN;
    if (!expectedToken || !token || !timingSafeEqualHex(token, expectedToken)) {
      return Response.json({ error: "invalid_token" }, { status: 401 });
    }

    const report = parseDeliveryReport(bodyToRecord(req.headers.get("Content-Type"), await req.text()));
    if (!report) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }

    const notificationId = await ctx.runMutation(internal.notifications.recordDeliveryReport, report);
    return Response.json({ matched: notificationId !== null }, { status: 200 });
  }),
});

export default http;
