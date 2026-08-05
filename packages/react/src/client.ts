// AgentClient — the framework-agnostic controller the React hooks wrap.
//
// It owns: the thread, the current run, pending user decisions, and background
// jobs. Kept outside React so the same object can be driven from a test, a CLI,
// or a non-React host — the hooks are a thin `useSyncExternalStore` over it.

import {
  initialRunState,
  reduceRunEvent,
  runAgent,
  resumeJobs,
  type Card,
  type CardAction,
  type ContentPart,
  type ContextBuilder,
  type JobStore,
  type Message,
  type Provider,
  type RunConfig,
  type RunEvent,
  type RunMode,
  type RunState,
  type StoredJob,
  type ThreadMeta,
  type ThreadStore,
  type ToolCallRequest,
  type ToolRegistry,
  type ToolResolution,
  assistantMessage,
  nextId,
  threadSnapshot,
  userMessage,
} from "@agentloom/core";
import { Store } from "./store.js";

export type ThreadState = {
  id: string;
  messages: Message[];
  run: RunState;
  /** Cards from the CURRENT run; committed to messages when the run finishes. */
  cards: Card[];
  jobs: StoredJob[];
  status: RunState["status"];
  error?: unknown;
};

export type AgentClientConfig = {
  provider: Provider;
  model: string;
  contextBuilder: ContextBuilder;
  tools: ToolRegistry;
  toolResolution: ToolResolution;
  mode?: RunMode;
  maxSteps?: number;
  vars?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?: RunConfig["reasoning"];
  jobStore?: JobStore;
  /** When set, the thread is saved after each user and assistant turn. */
  threadStore?: ThreadStore;
  onHostTool?: (call: ToolCallRequest) => Promise<unknown>;
  /** Persisted thread to hydrate from. */
  initialMessages?: Message[];
  threadId?: string;
};

/** A card waiting on the user, with the resolver that unblocks the run. */
type PendingDecision = { card: Card; resolve: (action: CardAction) => void };

export class AgentClient {
  readonly store: Store<ThreadState>;
  private config: AgentClientConfig;
  private controller: AbortController | null = null;
  private pending = new Map<string, PendingDecision>();
  /** Meta of the last snapshot saved, so createdAt/title survive re-saves. */
  private threadMeta: ThreadMeta | undefined;

  constructor(config: AgentClientConfig) {
    this.config = config;
    this.store = new Store<ThreadState>({
      id: config.threadId ?? nextId("thread"),
      messages: config.initialMessages ?? [],
      run: initialRunState("", config.mode ?? "stream"),
      cards: [],
      jobs: [],
      status: "idle",
    });
  }

  /** Update config in place (model switch, preset toggle) without losing the thread. */
  configure(patch: Partial<AgentClientConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  getConfig(): AgentClientConfig {
    return this.config;
  }

  get isRunning(): boolean {
    const { status } = this.store.get();
    return status === "running" || status === "awaiting-user";
  }

  /** Append a user message and run a turn. */
  async send(input: string | ContentPart[], opts: { forceSkillIds?: string[] } = {}): Promise<void> {
    if (this.isRunning) throw new Error("A run is already in progress. Call stop() first.");
    const message = userMessage(input);
    this.store.set((s) => ({ ...s, messages: [...s.messages, message] }));
    // Persist the user turn before running — a reload mid-run keeps it.
    this.persist();
    await this.run([...this.store.get().messages], opts);
  }

  /** Re-run from the last user message, discarding the assistant turn after it. */
  async regenerate(opts: { forceSkillIds?: string[] } = {}): Promise<void> {
    if (this.isRunning) throw new Error("A run is already in progress.");
    const { messages } = this.store.get();
    let cut = messages.length;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "user") {
        cut = i + 1;
        break;
      }
    }
    const trimmed = messages.slice(0, cut);
    this.store.set((s) => ({ ...s, messages: trimmed }));
    await this.run(trimmed, opts);
  }

  private async run(messages: Message[], opts: { forceSkillIds?: string[] }): Promise<void> {
    this.controller = new AbortController();
    const mode = this.config.mode ?? "stream";
    this.store.set((s) => ({
      ...s,
      run: initialRunState(nextId("run"), mode),
      cards: [],
      status: "running",
      error: undefined,
    }));

    const runConfig: RunConfig = {
      provider: this.config.provider,
      model: this.config.model,
      contextBuilder: this.config.contextBuilder,
      tools: this.config.tools,
      toolResolution: this.config.toolResolution,
      mode,
      maxSteps: this.config.maxSteps,
      vars: this.config.vars,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxOutputTokens,
      reasoning: this.config.reasoning,
      signal: this.controller.signal,
      forceSkillIds: opts.forceSkillIds,
      onHostTool: this.config.onHostTool,
      // Suspend the run on an interactive card; `respond()` resolves it.
      onUserDecision: (callId, card) =>
        new Promise<CardAction>((resolve) => {
          this.pending.set(callId, { card, resolve });
        }),
    };

    try {
      for await (const event of runAgent(messages, runConfig)) {
        this.apply(event);
      }
    } catch (e) {
      this.store.set((s) => ({ ...s, status: "error", error: e }));
    } finally {
      this.controller = null;
      this.commitRun();
    }
  }

  private apply(event: RunEvent): void {
    this.store.set((s) => {
      const run = reduceRunEvent(s.run, event);
      const next: ThreadState = { ...s, run, status: run.status, cards: run.cards };
      if (event.type === "job-started" && this.config.jobStore) {
        const job: StoredJob = {
          handle: event.handle,
          status: "queued",
          threadId: s.id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        // Fire and forget: persistence must not stall the run.
        void this.config.jobStore.put(job);
        next.jobs = [job, ...s.jobs];
      }
      if (event.type === "job-status") {
        next.jobs = s.jobs.map((j) => (j.handle.id === event.handle.id ? { ...j, status: event.status, updatedAt: Date.now() } : j));
      }
      if (event.type === "error") next.error = event.error;
      return next;
    });
  }

  /**
   * Fold the finished run's parts into the thread as one assistant message.
   *
   * Cards are attached as artifact parts so a reloaded thread still renders
   * them — the ContextBuilder strips artifacts before they reach a provider,
   * so this costs nothing at request time.
   */
  private commitRun(): void {
    this.store.set((s) => {
      const parts = s.run.parts;
      if (!parts.length && !s.run.cards.length) return { ...s, status: s.run.status };

      const cardParts: ContentPart[] = s.run.cards.map((c) => ({
        type: "artifact",
        id: c.id,
        kind: `card:${(c.spec as { kind?: string }).kind ?? "unknown"}`,
        data: c.spec,
      }));

      return {
        ...s,
        messages: [...s.messages, assistantMessage([...parts, ...cardParts])],
        status: s.run.status,
      };
    });
    this.persist();
  }

  /**
   * Fire-and-forget save, the same posture as the job store put: persistence
   * must not stall the run, and a failed save degrades to "not saved", never
   * to a broken thread.
   */
  private persist(): void {
    const store = this.config.threadStore;
    if (!store) return;
    const s = this.store.get();
    if (this.threadMeta && this.threadMeta.id !== s.id) this.threadMeta = undefined;
    void (async () => {
      // A client hydrated via config (threadId/initialMessages) has no meta in
      // hand; read the stored one so createdAt and title survive the reload.
      const prior = this.threadMeta ?? (await store.load(s.id))?.meta;
      const snapshot = threadSnapshot(s.id, s.messages, prior);
      this.threadMeta = snapshot.meta;
      await store.save(snapshot);
    })().catch(() => {
      // Fire-and-forget: a failed save degrades to "not saved", never a crash.
    });
  }

  /**
   * Load a stored thread and replace the current one. Returns false when the
   * id is unknown (the current thread is left untouched).
   */
  async openThread(id: string): Promise<boolean> {
    const store = this.config.threadStore;
    if (!store) return false;
    const stored = await store.load(id);
    if (!stored) return false;
    this.stop();
    this.threadMeta = stored.meta;
    this.store.set((s) => ({
      ...s,
      id: stored.meta.id,
      messages: stored.messages,
      cards: [],
      run: initialRunState("", this.config.mode ?? "stream"),
      status: "idle",
      error: undefined,
    }));
    return true;
  }

  /** Start a fresh thread under a new id (`clear()` keeps the id; this doesn't). */
  newThread(): void {
    this.stop();
    this.threadMeta = undefined;
    this.store.set((s) => ({
      ...s,
      id: nextId("thread"),
      messages: [],
      cards: [],
      run: initialRunState("", this.config.mode ?? "stream"),
      status: "idle",
      error: undefined,
    }));
  }

  /** Answer an interactive card. Unblocks the suspended tool. */
  respond(action: CardAction): void {
    const entry = this.pending.get(action.callId ?? "");
    if (!entry) return;
    this.pending.delete(action.callId ?? "");
    entry.resolve(action);
  }

  /** The card currently blocking the run, if any. */
  pendingCard(): Card | undefined {
    return this.store.get().run.pendingCard;
  }

  stop(): void {
    this.controller?.abort();
    // Release any suspended tool so the run can unwind instead of hanging.
    for (const [callId, entry] of this.pending) {
      entry.resolve({ cardId: entry.card.id, callId, kind: "cancel", type: "cancel", at: Date.now() });
    }
    this.pending.clear();
  }

  clear(): void {
    this.stop();
    this.store.set((s) => ({ ...s, messages: [], cards: [], run: initialRunState("", this.config.mode ?? "stream"), status: "idle", error: undefined }));
  }

  /** Re-poll background jobs from a previous session. Call on mount. */
  async resumeBackgroundJobs(): Promise<void> {
    const store = this.config.jobStore;
    if (!store) return;
    const results = await resumeJobs(store, { [this.config.provider.id]: this.config.provider });
    this.store.set((s) => ({ ...s, jobs: results.map((r) => r.job) }));

    for (const { snapshot } of results) {
      if (snapshot.status === "completed" && snapshot.result) {
        this.store.set((s) => ({ ...s, messages: [...s.messages, assistantMessage(snapshot.result!.parts)] }));
      } else if (snapshot.status === "failed") {
        this.store.set((s) => ({
          ...s,
          messages: [
            ...s.messages,
            assistantMessage([{ type: "text", text: `_${snapshot.error?.message ?? "A background job failed."}_` }]),
          ],
        }));
      }
    }
  }
}
