// The BFF proxy route. This is the whole server side of the default transport.
//
// Note what is NOT here: no request building, no streaming logic, no provider
// knowledge. The adapter runs in the browser and describes the call it wants;
// this route decides whether that call is allowed and attaches the key. That
// split is why the same adapter code works BYOK-direct and server-proxied.

import { createProxyHandler } from "@agentloom/core";

export const runtime = "nodejs";
// Streaming responses must not be buffered or cached by the framework.
export const dynamic = "force-dynamic";

const handler = createProxyHandler({
  providers: {
    openai: {
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: () => {
        const key = process.env.OPENAI_API_KEY;
        if (!key) throw new Error("OPENAI_API_KEY is not set. Copy .env.example to .env.local and fill it in.");
        return key;
      },
      // The allowlist is the security boundary. Without it this route is an open
      // relay for the key — anyone who can reach it could call /fine_tuning,
      // /files, or any other endpoint on your account.
      allowPaths: [
        "/responses",
        "/responses/*",
        "/responses/*/cancel",
        "/chat/completions",
        "/models",
        // Method-scoped on purpose: uploads only. A bare "/files" would also
        // open GET /files (list every file on the account) and DELETE.
        "POST /files",
      ],
    },
  },
  // A real deployment authenticates the session and meters here. The playground
  // is single-user and local, so it only refuses when the key is missing.
  authorize: () =>
    Boolean(process.env.OPENAI_API_KEY) ||
    new Response(
      JSON.stringify({ error: { message: "Server has no OPENAI_API_KEY. Add one to .env.local, or switch this page to BYOK mode." } }),
      { status: 503, headers: { "content-type": "application/json" } },
    ),
});

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}
