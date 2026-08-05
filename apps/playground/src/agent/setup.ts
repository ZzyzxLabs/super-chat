"use client";

// Wiring. This file is the "how do I actually use this framework" answer, and
// it is deliberately short — every subsystem is assembled here in one place.

import {
  BUILTIN_CARDS,
  CardRegistry,
  ContextBuilder,
  SkillRegistry,
  ToolRegistry,
  createBuiltinTools,
  createDirectTransport,
  createLocalFileStore,
  createLocalJobStore,
  createLocalThreadStore,
  createOpenAIProvider,
  createProxyTransport,
  type Provider,
  type Transport,
} from "@agentloom/core";
import { createDemoTransport } from "./demo-transport";
import { DOMAIN_TOOLS } from "./tools";
import { LEGAL_TOOLS, MARKETING_TOOLS } from "./tools-domains";
import { SKILLS } from "./skills";

export type TransportMode = "demo" | "proxy" | "direct";

export const cards = new CardRegistry(BUILTIN_CARDS);
export const skills = new SkillRegistry(SKILLS, { maxMatched: 3 });

/**
 * Preset assignment. Note that `createAlert` is the only tool in `executor` —
 * a preset toggle in the UI is therefore a real capability boundary, not a
 * cosmetic filter.
 */
export function buildToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Built-ins (visualize, updateCard, loadSkill) are always-available reads.
  registry.registerAll(createBuiltinTools({ cards, skills }), ["observer"]);

  // Domain tools get NO preset: they are private by default and surface only
  // when the skill that documents them matches. A legal question should not put
  // twelve marketing tool schemas in front of the model.
  registry.registerAll(LEGAL_TOOLS);
  registry.registerAll(MARKETING_TOOLS);
  for (const tool of DOMAIN_TOOLS) {
    // `createAlert` acts on the world, so it carries a preset as well. The
    // markets skill names it, but naming only grants relevance — the executor
    // preset still has to be enabled for it to appear.
    if (tool.name === "createAlert") registry.register(tool, ["executor"]);
    else registry.register(tool);
  }

  return registry;
}

export function buildTransport(mode: TransportMode, apiKey?: string): Transport {
  // Demo replaces only the network. The adapter, runtime, tools, cards and
  // context builder above it are the real ones.
  if (mode === "demo") return createDemoTransport();
  if (mode === "direct") {
    if (!apiKey) throw new Error("BYOK mode needs an API key.");
    return createDirectTransport({
      baseUrl: "https://api.openai.com/v1",
      apiKey,
      // Named to make the trade-off explicit: this ships the key to the client.
      dangerouslyAllowBrowser: true,
    });
  }
  return createProxyTransport({ url: "/api/agent" });
}

export function buildProvider(transport: Transport, mode: TransportMode = "proxy"): Provider {
  // Demo gets its OWN provider id: providerFile refs are stamped with the id
  // that minted them, so a fake `file_demo_N` attached in demo mode degrades
  // to a readable placeholder when the thread is replayed against real
  // OpenAI, instead of 400ing the thread forever.
  return createOpenAIProvider({ transport, dialect: "responses", ...(mode === "demo" ? { id: "demo" } : {}) });
}

export function buildContextBuilder(contextWindow = 128_000): ContextBuilder {
  return new ContextBuilder({
    skills,
    contextWindow,
    maxOutputTokens: 4_000,
    keepRecent: 8,
    identity: [
      "You are the agentloom demo agent.",
      "Today is 3 August 2026. All market data comes from a synthetic demo feed — say so if the user asks whether it is real.",
    ].join("\n"),
  });
}

export const jobStore = createLocalJobStore("agentloom:playground:jobs");
export const fileStore = createLocalFileStore("agentloom:playground:files");
export const threadStore = createLocalThreadStore("agentloom:playground:threads");

export const MODELS = ["gpt-5.2", "gpt-5.2-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o-mini"];
