// The server half of `createRestThreadStore` — the four calls that contract
// names, and nothing else.
//
// Storage here is a module-level Map: enough to prove the wire contract and to
// let the /run panel switch between localStorage and a server without touching
// client code. A real deployment swaps the Map for a database and adds the one
// thing this deliberately omits: per-user scoping in `authorize`, so thread ids
// are not a shared namespace.

import type { StoredThread, ThreadMeta } from "@agentloom/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const threads = new Map<string, StoredThread>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const idFrom = (params: { id?: string[] }): string | undefined => params.id?.[0];

export async function GET(_req: Request, ctx: { params: Promise<{ id?: string[] }> }): Promise<Response> {
  const id = idFrom(await ctx.params);
  if (!id) {
    const metas: ThreadMeta[] = [...threads.values()].map((t) => t.meta).sort((a, b) => b.updatedAt - a.updatedAt);
    return json(metas);
  }
  const thread = threads.get(id);
  // 404 is the contract's "no such thread" — the client reads it as absent.
  return thread ? json(thread) : json({ error: { message: "Not found" } }, 404);
}

export async function PUT(request: Request, ctx: { params: Promise<{ id?: string[] }> }): Promise<Response> {
  const id = idFrom(await ctx.params);
  if (!id) return json({ error: { message: "Thread id required." } }, 400);
  let body: StoredThread;
  try {
    body = (await request.json()) as StoredThread;
  } catch {
    return json({ error: { message: "Body must be a StoredThread." } }, 400);
  }
  if (!body?.meta?.id || !Array.isArray(body.messages)) {
    return json({ error: { message: "Body must be a StoredThread." } }, 400);
  }
  // Trust the path, not the payload — a mismatched body.meta.id must not let
  // one thread overwrite another.
  threads.set(id, { ...body, meta: { ...body.meta, id } });
  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id?: string[] }> }): Promise<Response> {
  const id = idFrom(await ctx.params);
  if (!id) return json({ error: { message: "Thread id required." } }, 400);
  threads.delete(id);
  return new Response(null, { status: 204 });
}
