// ProxyTransport — the browser calls your own backend, which injects the key and
// forwards to the provider. This is the default, and the only shape that is
// honest in a multi-user app.
//
// The wire format between client and BFF is intentionally trivial: the client
// declares which provider, path, method and body it wants; the server decides
// whether to allow it. `createProxyHandler` (server.ts) is the matching half,
// and it allowlists paths — a proxy that forwards any path is an open relay for
// your API key.

import type { Transport, TransportRequest } from "./types.js";

export type ProxyTransportConfig = {
  /** Base path of your proxy route, e.g. "/api/agent". */
  url: string;
  /** Extra headers (session cookie is automatic; use this for CSRF tokens). */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  credentials?: RequestCredentials;
  fetchImpl?: typeof fetch;
};

/** The envelope a ProxyTransport POSTs to the BFF. Exported so the server half can type it. */
export type ProxyEnvelope = {
  provider: string;
  path: string;
  method: "GET" | "POST" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  stream?: boolean;
};

export function createProxyTransport(config: ProxyTransportConfig): Transport {
  const doFetch = config.fetchImpl ?? globalThis.fetch;

  return {
    kind: "proxy",
    credentialSafe: true,
    async fetch(req: TransportRequest): Promise<Response> {
      const extra = typeof config.headers === "function" ? await config.headers() : config.headers;
      const envelope: ProxyEnvelope = {
        provider: req.provider,
        path: req.path,
        method: req.method,
        body: req.body,
        query: req.query,
        stream: req.stream,
      };

      // Always POST the envelope, even for provider-side GETs (job polling):
      // one method and one body shape keeps the server handler and any CSRF
      // middleware simple, and provider GETs carry no cacheable semantics for us.
      return doFetch(config.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(req.stream ? { accept: "text/event-stream" } : {}),
          ...extra,
          ...req.headers,
        },
        body: JSON.stringify(envelope),
        credentials: config.credentials ?? "same-origin",
        signal: req.signal,
      });
    },
  };
}
