import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AnthropicProvider } from "@/server/ai/providers/anthropic";
import { OpenAICompatibleProvider } from "@/server/ai/providers/openai";
import { OllamaProvider } from "@/server/ai/providers/ollama";
import { AIRouter, NoProviderAvailableError } from "@/server/ai/router";
import { ProviderError, type ProviderRuntimeConfig } from "@/server/ai/types";
import { createOrgWithUser } from "../helpers/db";
import { fakeServer } from "../helpers/fake-server";

const cfg = (over: Partial<ProviderRuntimeConfig>): ProviderRuntimeConfig => ({
  id: "p1",
  kind: "MOCK",
  name: "test",
  model: "m",
  baseUrl: null,
  apiKey: "test-key-not-real",
  maxOutputTokens: 256,
  temperature: null,
  timeoutMs: 5000,
  maxRetries: 0,
  contextTokenLimit: 8000,
  settings: {},
  ...over,
});

let closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

describe("Anthropic adapter", () => {
  it("sends a Messages API request with tools and parses tool calls and usage", async () => {
    const srv = await fakeServer(() => ({
      body: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "toolu_1", name: "get_ticket_status", input: { ticket_number: 42 } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 120, output_tokens: 30 },
      },
    }));
    closers.push(srv.close);
    const p = new AnthropicProvider(
      cfg({ kind: "ANTHROPIC", model: "claude-opus-5-5", baseUrl: srv.url, settings: { effort: "medium" } }),
    );
    const r = await p.generateResponse({
      system: "sys",
      messages: [{ role: "user", content: "status of ticket 42?" }],
      tools: [
        {
          name: "get_ticket_status",
          description: "Look up a ticket",
          parameters: { type: "object", properties: { ticket_number: { type: "integer" } } },
        },
      ],
      temperature: 0,
    });
    expect(r.toolCalls).toEqual([
      { id: "toolu_1", name: "get_ticket_status", arguments: { ticket_number: 42 } },
    ]);
    expect(r.stopReason).toBe("tool_use");
    expect(r.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(r.providerData?.provider).toBe("ANTHROPIC");
    const req = srv.requests[0]!;
    expect(req.url).toMatch(/\/v1\/messages/);
    expect(req.headers["x-api-key"]).toBe("test-key-not-real");
    expect(String(req.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    const body = req.body as Record<string, unknown>;
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.system).toBe("sys");
    expect(body).not.toHaveProperty("temperature"); // only sent when settings.sendTemperature is true
    expect(body.output_config).toEqual({ effort: "medium" });
    expect(body.fallbacks).toBe("default");
  });

  it("maps refusals and retries retryable errors", async () => {
    let calls = 0;
    const srv = await fakeServer(() => {
      calls++;
      if (calls === 1)
        return {
          status: 529,
          body: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
        };
      return {
        body: {
          id: "m",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: [],
          stop_reason: "refusal",
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      };
    });
    closers.push(srv.close);
    const p = new AnthropicProvider(
      cfg({ kind: "ANTHROPIC", model: "claude-sonnet-5-5", baseUrl: srv.url, maxRetries: 1 }),
    );
    const r = await p.generateResponse({ system: "s", messages: [{ role: "user", content: "x" }] });
    expect(calls).toBe(2);
    expect(r.stopReason).toBe("refusal");
  });

  it("does not retry authentication errors", async () => {
    const srv = await fakeServer(() => ({
      status: 401,
      body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
    }));
    closers.push(srv.close);
    const p = new AnthropicProvider(
      cfg({ kind: "ANTHROPIC", model: "claude-opus-5-5", baseUrl: srv.url, maxRetries: 3 }),
    );
    const err = await p
      .generateResponse({ system: "s", messages: [{ role: "user", content: "x" }] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).retryable).toBe(false);
    expect(srv.requests).toHaveLength(1);
  });
});

describe("OpenAI-compatible adapter", () => {
  it("sends chat completions and parses tool calls", async () => {
    const srv = await fakeServer(() => ({
      body: {
        id: "c1",
        object: "chat.completion",
        model: "local-model",
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "search_knowledge", arguments: '{"query":"hours"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      },
    }));
    closers.push(srv.close);
    const p = new OpenAICompatibleProvider(
      cfg({ kind: "OPENAI_COMPATIBLE", model: "local-model", baseUrl: `${srv.url}/v1`, temperature: 0.2 }),
    );
    const r = await p.generateResponse({
      system: "sys",
      messages: [{ role: "user", content: "hours?" }],
      tools: [{ name: "search_knowledge", description: "d", parameters: { type: "object", properties: {} } }],
    });
    expect(r.toolCalls).toEqual([{ id: "call_1", name: "search_knowledge", arguments: { query: "hours" } }]);
    expect(r.usage).toEqual({ inputTokens: 50, outputTokens: 10 });
    const body = srv.requests[0]!.body as Record<string, unknown>;
    expect(srv.requests[0]!.url).toBe("/v1/chat/completions");
    expect((body.messages as Array<{ role: string }>)[0]!.role).toBe("system");
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(256);
  });
});

describe("Ollama adapter", () => {
  it("calls /api/chat and reports health from /api/tags", async () => {
    const srv = await fakeServer((req) =>
      req.url === "/api/tags"
        ? { body: { models: [{ name: "llama3.1:8b" }] } }
        : {
            body: {
              model: "llama3.1:8b",
              message: { role: "assistant", content: '{"reply":"hi"}' },
              done: true,
              done_reason: "stop",
              prompt_eval_count: 12,
              eval_count: 5,
            },
          },
    );
    closers.push(srv.close);
    const p = new OllamaProvider(
      cfg({ kind: "OLLAMA", model: "llama3.1:8b", baseUrl: srv.url, apiKey: null }),
    );
    const r = await p.generateResponse({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      json: true,
    });
    expect(r.text).toBe('{"reply":"hi"}');
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
    expect((srv.requests[0]!.body as Record<string, unknown>).format).toBe("json");
    expect((await p.healthCheck()).ok).toBe(true);
  });
});

describe("provider routing and fallback", () => {
  async function orgWith(primary: { outage: boolean }, fallback?: { allow: boolean; outage?: boolean }) {
    const { org } = await createOrgWithUser("OWNER");
    await prisma.aIProviderConfig.deleteMany({ where: { orgId: org.id } });
    const p = await prisma.aIProviderConfig.create({
      data: {
        orgId: org.id,
        name: "primary",
        kind: "MOCK",
        model: "mock-a",
        isPrimary: true,
        maxRetries: 0,
        settings: { simulateOutage: primary.outage },
      },
    });
    const f = fallback
      ? await prisma.aIProviderConfig.create({
          data: {
            orgId: org.id,
            name: "backup",
            kind: "MOCK",
            model: "mock-b",
            allowAsFallback: fallback.allow,
            maxRetries: 0,
            settings: { simulateOutage: !!fallback.outage },
          },
        })
      : null;
    return { org, p, f };
  }
  const call = (r: AIRouter) =>
    r.run("chat", async (prov) => {
      const response = await prov.generateResponse({
        system: "s",
        messages: [{ role: "user", content: "hi" }],
      });
      return { value: response.text, response };
    });

  it("falls back only to providers explicitly allowed as fallback and records usage", async () => {
    const { org, f } = await orgWith({ outage: true }, { allow: true });
    const res = await call(await AIRouter.forOrg(org.id));
    expect(res.fellBack).toBe(true);
    expect(res.config.id).toBe(f!.id);
    const usage = await prisma.usageRecord.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: "asc" },
    });
    expect(usage.map((u) => [u.model, u.success])).toEqual([
      ["mock-a", false],
      ["mock-b", true],
    ]);
  });

  it("never sends a conversation to a provider that is not allowed as fallback", async () => {
    const { org } = await orgWith({ outage: true }, { allow: false });
    await expect(call(await AIRouter.forOrg(org.id))).rejects.toBeInstanceOf(NoProviderAvailableError);
    expect(await prisma.usageRecord.count({ where: { orgId: org.id, model: "mock-b" } })).toBe(0);
  });

  it("skips providers whose monthly token budget is used up", async () => {
    const { org, p } = await orgWith({ outage: false });
    await prisma.aIProviderConfig.update({ where: { id: p.id }, data: { monthlyTokenBudget: 100 } });
    await prisma.usageRecord.create({
      data: {
        orgId: org.id,
        providerConfigId: p.id,
        kind: "chat",
        provider: "MOCK",
        model: "mock-a",
        inputTokens: 90,
        outputTokens: 20,
        success: true,
      },
    });
    await expect(call(await AIRouter.forOrg(org.id))).rejects.toBeInstanceOf(NoProviderAvailableError);
  });

  it("escalates the conversation when every provider fails after retries", async () => {
    const { org } = await orgWith({ outage: true });
    await prisma.organization.update({ where: { id: org.id }, data: { autonomyMode: "AUTONOMOUS" } });
    const { simulatorChannel } = await import("../helpers/db");
    const { customerSays } = await import("../helpers/pipeline");
    const { processInbound } = await import("@/server/agent/engine");
    const msg = await customerSays(await simulatorChannel(org.id), "Is the shop open today?");
    const firstTry = await processInbound(msg.id, { attempt: 1, maxAttempts: 3 });
    expect(firstTry.status).toBe("RETRY");
    const lastTry = await processInbound(msg.id, { attempt: 3, maxAttempts: 3 });
    expect(lastTry.status).toBe("COMPLETED");
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: msg.conversationId } });
    expect(conv.control).toBe("PENDING_HUMAN");
  });
});
