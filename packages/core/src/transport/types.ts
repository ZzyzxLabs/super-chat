// The transport is the ONLY thing that knows where a request physically goes and
// who holds the credential. Adapters build a `TransportRequest` describing the
// provider-relative call ("POST /responses with this body") and hand it over.
//
// That split is what lets the same OpenAI adapter run:
//   • in the browser against a BFF that injects the key server-side (default), and
//   • in the browser straight at api.openai.com with a user-supplied key (BYOK), and
//   • on a server with the key in env,
// without a single conditional inside the adapter.

export type TransportRequest = {
  /** Provider id ("openai"). The proxy transport uses it to route. */
  provider: string;
  /** Provider-relative path, always leading-slash ("/responses", "/responses/{id}"). */
  path: string;
  method: "GET" | "POST" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /** Hint that the response is SSE. Transports must not buffer these. */
  stream?: boolean;
  signal?: AbortSignal;
  /** Extra query params, appended after any already present in `path`. */
  query?: Record<string, string | number | boolean | undefined>;
};

export type Transport = {
  readonly kind: "direct" | "proxy" | "custom";
  /**
   * Perform the call and return the raw `Response`. Returning `Response` rather
   * than parsed JSON is deliberate: streaming adapters need the body stream, and
   * error mapping needs status + headers (Retry-After).
   */
  fetch(req: TransportRequest): Promise<Response>;
  /**
   * Whether this transport can be trusted with a secret. `false` for
   * DirectTransport in a browser — the runtime surfaces this so a host can warn
   * rather than silently shipping a key to the client.
   */
  readonly credentialSafe: boolean;
};

export type RetryPolicy = {
  maxAttempts: number;
  /** First backoff in ms; doubled each attempt with full jitter. */
  baseDelayMs: number;
  maxDelayMs: number;
};

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 400, maxDelayMs: 8_000 };
