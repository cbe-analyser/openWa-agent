import { randomBytes } from "node:crypto";
import { Prisma, type Conversation, type Organization } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { logger, errorMessage } from "../logger";
import { AIRouter, NoProviderAvailableError } from "../ai/router";
import { extractJsonObject } from "../ai/json";
import type { AIResponse, ChatTurn, IntentResult } from "../ai/types";
import { getRetriever, type RetrievalResult } from "../knowledge/retrieval";
import { queueOutbound } from "../channels/outbound";
import { availableTools, executeTool } from "../tools/executor";
import { enqueue } from "../jobs/queue";
import { emitEvent } from "../services/events";
import { aiSendBlockedReason } from "../services/system";
import { cancelCustomerFollowUps, scheduleFollowUp } from "../services/followups";
import { BUSINESS_FACT_INTENTS, intentsForOrg, TROUBLESHOOTING_INTENTS } from "./intents";
import { decide, type PolicyDecision, type Resolution } from "./policy";
import { buildContextTurn, buildSystemPrompt } from "./prompts";
import { checkOutput, detectInbound, matchesKeyword } from "./safety";

const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_CALLS = 6;
const HISTORY_LIMIT = 20;

const finalSchema = z.object({
  reply: z.string().max(4000),
  confidence: z.number().min(0).max(1).catch(0.5),
  resolution: z.enum(["resolved", "in_progress", "needs_info", "needs_human"]).catch("in_progress"),
  used_sources: z.array(z.string()).catch([]),
  follow_up_hours: z.number().min(1).max(72).nullable().optional().catch(null),
  escalation_reason: z.string().max(300).nullable().optional().catch(null),
});

interface Step {
  step: string;
  detail?: unknown;
  at: string;
}

export interface ProcessOptions {
  attempt: number;
  maxAttempts: number;
}

export type ProcessOutcome =
  | { status: "SKIPPED"; reason: string }
  | { status: "HANDLED"; decision: string }
  | { status: "COMPLETED"; decision: PolicyDecision; agentRunId: string }
  | { status: "RETRY"; reason: string };

/** Rule-based fallback classification used only when every AI provider is unavailable. */
function fallbackIntent(text: string): IntentResult {
  const f = detectInbound(text);
  return {
    intent: f.refund
      ? "refund_request"
      : f.financialTransaction
        ? "payment_dispute"
        : f.securityIncident
          ? "account_access"
          : "other",
    urgency: f.securityIncident ? "URGENT" : "NORMAL",
    language: "und",
    sentiment: "neutral",
    wantsHuman: f.wantsHuman,
    confidence: 0.3,
  };
}

function historyTurns(
  messages: Array<{ direction: string; authorType: string; body: string | null; type: string }>,
): ChatTurn[] {
  return messages.map((m) => {
    const text = m.body?.trim() || `[${m.type} message]`;
    if (m.direction === "INBOUND")
      return { role: "user" as const, content: text.replace(/</g, "‹").replace(/>/g, "›") };
    const who = m.authorType === "HUMAN" ? "(sent by a human team member) " : "";
    return { role: "assistant" as const, content: who + text };
  });
}

/**
 * The agent workflow for one inbound message:
 * RECEIVE → IDENTIFY → UNDERSTAND → RETRIEVE → REASON/ACT (tools) → VERIFY → RESPOND (policy) → RECORD → FOLLOW UP / ESCALATE.
 */
export async function processInbound(
  messageId: string,
  opts: ProcessOptions = { attempt: 1, maxAttempts: 1 },
): Promise<ProcessOutcome> {
  const steps: Step[] = [];
  const log = (step: string, detail?: unknown) => steps.push({ step, detail, at: new Date().toISOString() });

  // RECEIVE / IDENTIFY
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { conversation: { include: { customer: true, channel: true, org: true } } },
  });
  if (!message || message.direction !== "INBOUND") return { status: "SKIPPED", reason: "not_inbound" };
  const conv = message.conversation;
  const org = conv.org;
  const customer = conv.customer;
  const text = (message.body ?? "").slice(0, 4000);

  const existingRun = await prisma.agentRun.findUnique({ where: { triggerMessageId: message.id } });
  if (existingRun && existingRun.status !== "RETRYING")
    return { status: "SKIPPED", reason: "already_processed" };

  // Opt-out / opt-in keywords are handled deterministically (consent must not depend on the AI).
  if (matchesKeyword(text, org.optOutKeywords)) {
    await handleOptOut(org, conv, message.id);
    return { status: "HANDLED", decision: "opt_out" };
  }
  if (matchesKeyword(text, org.optInKeywords) && customer.optedOut) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { optedOut: false, optedInAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        actorType: "SYSTEM",
        action: "customer.opted_in",
        targetType: "customer",
        targetId: customer.id,
      },
    });
  }

  // Coalesce bursts: if the customer has already sent a newer message, let that run answer everything.
  const newer = await prisma.message.count({
    where: { conversationId: conv.id, direction: "INBOUND", createdAt: { gt: message.createdAt } },
  });
  if (newer > 0) return recordSkip(org.id, conv.id, message.id, "superseded_by_newer_message");

  const blocked = await aiSendBlockedReason(org.id, conv.id);
  if (blocked) return recordSkip(org.id, conv.id, message.id, blocked);

  const router = await AIRouter.forOrg(org.id);
  if (!router.hasProvider) {
    await escalate(org, conv, message.id, ["no_ai_provider_configured"], null, null);
    return recordSkip(org.id, conv.id, message.id, "no_ai_provider_configured");
  }

  const run = existingRun
    ? existingRun
    : await prisma.agentRun
        .create({
          data: { orgId: org.id, conversationId: conv.id, triggerMessageId: message.id, status: "RUNNING" },
        })
        .catch((e) => {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
          throw e;
        });
  if (!run) return { status: "SKIPPED", reason: "already_processed" };
  const startVersion = conv.controlVersion;
  const started = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  const addUsage = (r: AIResponse) => {
    inputTokens += r.usage.inputTokens;
    outputTokens += r.usage.outputTokens;
  };

  try {
    const history = await prisma.message.findMany({
      where: {
        conversationId: conv.id,
        status: { notIn: ["PENDING_APPROVAL", "REJECTED", "SUPERSEDED"] },
        createdAt: { lte: message.createdAt },
      },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      select: { direction: true, authorType: true, body: true, type: true, id: true },
    });
    history.reverse();
    const prior = history.filter((h) => h.id !== message.id);
    const historyText = prior
      .slice(-8)
      .map((m) => `${m.direction === "INBOUND" ? "Customer" : "Business"}: ${m.body ?? `[${m.type}]`}`)
      .join("\n");

    // UNDERSTAND
    const flags = detectInbound(text);
    log("safety_flags", Object.fromEntries(Object.entries(flags).filter(([, v]) => v)));
    const intents = intentsForOrg(org.customIntents);
    let classification: IntentResult;
    try {
      const routed = await router.run(
        "classify",
        async (p) => {
          const r = await p.classifyIntent({
            text: text || `[${message.type}]`,
            history: historyText,
            intents,
          });
          return { value: r.result, response: r.response };
        },
        { agentRunId: run.id },
      );
      addUsage(routed.response);
      classification = routed.value;
    } catch (err) {
      if (err instanceof NoProviderAvailableError) throw err;
      classification = fallbackIntent(text);
      log("classification_fallback", errorMessage(err));
    }
    log("classified", classification);

    // RETRIEVE
    const prevCustomer = prior.filter((m) => m.direction === "INBOUND").slice(-1)[0]?.body ?? "";
    const query = text.length < 40 && prevCustomer ? `${prevCustomer}\n${text}` : text;
    let retrieval: RetrievalResult = { chunks: [], sufficientEvidence: false };
    try {
      retrieval = await getRetriever().search(org.id, query, 5);
    } catch (err) {
      log("retrieval_error", errorMessage(err));
    }
    log("retrieved", {
      count: retrieval.chunks.length,
      sufficient: retrieval.sufficientEvidence,
      documents: [...new Set(retrieval.chunks.map((c) => c.documentTitle))],
    });

    // REASON / ACT
    const tools = await availableTools(org.id, true);
    const canary = `REF-${randomBytes(6).toString("hex")}`;
    const system = buildSystemPrompt(
      org,
      canary,
      tools.specs.map((t) => t.name),
    );
    const ctxTurn = buildContextTurn({
      customerName: customer.name ?? customer.profileName,
      summary: conv.summary,
      chunks: retrieval.chunks,
      sufficientEvidence: retrieval.sufficientEvidence,
      intent: classification.intent,
      latestMessage: text || `[${message.type} message without text]`,
    });
    const turns: ChatTurn[] = [...historyTurns(prior), { role: "user", content: ctxTurn.content }];

    const succeededTools = new Set<string>();
    let pendingApproval = false;
    let refusal = false;
    let finalText: string | null = null;
    let toolCallsMade = 0;
    let pinnedConfigId: string | undefined;
    let providerLabel = "";
    let modelName = "";

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const allowTools = round < MAX_TOOL_ROUNDS && toolCallsMade < MAX_TOOL_CALLS;
      const routed = await router.run(
        "chat",
        async (p) => {
          const r = await p.generateResponse({
            system,
            messages: turns,
            tools: allowTools ? tools.specs : undefined,
          });
          return { value: r, response: r };
        },
        { agentRunId: run.id, pinnedConfigId },
      );
      pinnedConfigId = routed.config.id; // keep one provider for the whole tool loop
      providerLabel = routed.config.kind;
      modelName = routed.response.model;
      if (routed.fellBack) log("provider_fallback", { used: routed.config.name });
      const res = routed.value;
      addUsage(res);
      if (res.stopReason === "refusal") {
        refusal = true;
        log("model_refusal");
        break;
      }
      if (res.toolCalls.length && allowTools) {
        turns.push({
          role: "assistant",
          content: res.text,
          toolCalls: res.toolCalls,
          providerData: res.providerData,
        });
        for (const call of res.toolCalls) {
          toolCallsMade++;
          const outcome =
            toolCallsMade > MAX_TOOL_CALLS
              ? ({ status: "DENIED", executionId: null, error: "Tool call limit reached" } as const)
              : await executeTool(call.name, call.arguments, {
                  orgId: org.id,
                  conversationId: conv.id,
                  customerId: customer.id,
                  agentRunId: run.id,
                  actor: "AI",
                  actorId: null,
                });
          log("tool", { name: call.name, status: outcome.status });
          if (outcome.status === "SUCCEEDED") succeededTools.add(call.name);
          if (outcome.status === "PENDING_APPROVAL") pendingApproval = true;
          const content =
            outcome.status === "SUCCEEDED"
              ? JSON.stringify(outcome.output)
              : outcome.status === "PENDING_APPROVAL"
                ? JSON.stringify({ status: "pending_approval", note: outcome.message })
                : JSON.stringify({ error: outcome.error });
          turns.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content,
            isError: outcome.status === "FAILED" || outcome.status === "DENIED",
          });
        }
        continue;
      }
      finalText = res.text;
      break;
    }

    // VERIFY
    const parsed = finalText ? finalSchema.safeParse(extractJsonObject(finalText)) : null;
    let reply = "";
    let confidence = 0;
    let resolution: Resolution = "needs_human";
    let usedSources: string[] = [];
    let followUpHours: number | null = null;
    if (parsed?.success) {
      reply = parsed.data.reply.trim();
      confidence = parsed.data.confidence;
      resolution = parsed.data.resolution;
      usedSources = parsed.data.used_sources.filter((s) => ctxTurn.sourceIds.has(s));
      followUpHours = parsed.data.follow_up_hours ?? null;
    } else if (finalText && !finalText.trim().startsWith("{")) {
      reply = finalText.trim();
      confidence = 0.4;
      resolution = "in_progress";
      log("unstructured_output");
    }
    // Answers about business facts must be grounded in retrieved knowledge or a tool result.
    if (
      BUSINESS_FACT_INTENTS.has(classification.intent) &&
      usedSources.length === 0 &&
      succeededTools.size === 0 &&
      resolution !== "needs_info"
    ) {
      confidence = Math.min(confidence, 0.55);
      log("ungrounded_answer_capped");
    }
    const output = checkOutput(reply, succeededTools, canary);
    const isTroubleshooting = TROUBLESHOOTING_INTENTS.has(classification.intent);
    const failedAttempts =
      isTroubleshooting && resolution !== "resolved"
        ? conv.failedAttempts + 1
        : resolution === "resolved"
          ? 0
          : conv.failedAttempts;
    const escalatingIntents = new Set(intents.filter((i) => i.escalate).map((i) => i.name));

    const decision = decide({
      mode: org.autonomyMode,
      threshold: org.confidenceThreshold,
      autoReplyIntents: org.autoReplyIntents,
      escalatingIntents,
      intent: classification.intent,
      urgency: classification.urgency,
      flags,
      wantsHumanModel: classification.wantsHuman,
      confidence,
      resolution,
      hasReply: reply.length > 0,
      output,
      pendingApproval,
      refusal,
      troubleshootingExhausted: isTroubleshooting && failedAttempts >= org.maxTroubleshootTurns,
    });
    log("decision", decision);

    // RESPOND / RECORD / ESCALATE — under a row lock so a human takeover cannot race the AI.
    const safeReply = output.asksForSecrets || output.leaksInstructions ? "" : reply;
    const citations = usedSources.map((s) => {
      const chunkId = ctxTurn.sourceIds.get(s)!;
      const c = retrieval.chunks.find((x) => x.chunkId === chunkId);
      return { ref: s, chunkId, documentId: c?.documentId, title: c?.documentTitle };
    });
    const finalDecision = await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        Array<Pick<Conversation, "control" | "controlVersion" | "aiPaused">>
      >`
        SELECT "control", "controlVersion", "aiPaused" FROM "Conversation" WHERE "id" = ${conv.id} FOR UPDATE`;
      if (!locked || locked.controlVersion !== startVersion || locked.control !== "AI" || locked.aiPaused) {
        return { action: "SUPERSEDED" as const, reasons: ["control_changed_during_run"] };
      }
      await tx.conversation.update({
        where: { id: conv.id },
        data: {
          intent: classification.intent,
          urgency: classification.urgency,
          language: classification.language,
          failedAttempts,
        },
      });
      if (decision.action === "SEND" || decision.action === "DRAFT") {
        await queueOutbound(tx, {
          orgId: org.id,
          conversationId: conv.id,
          channelId: conv.channelId,
          authorType: "AI",
          payload: { type: "text", text: safeReply },
          agentRunId: run.id,
          status: decision.action === "SEND" ? "QUEUED" : "PENDING_APPROVAL",
          metadata: { citations, confidence, reasons: decision.reasons },
        });
        if (decision.action === "SEND")
          await tx.conversation.update({ where: { id: conv.id }, data: { unreadCount: 0 } });
      } else if (decision.action === "IGNORE") {
        await tx.conversation.update({
          where: { id: conv.id },
          data: { tags: { push: "spam" }, unreadCount: 0 },
        });
      }
      return decision;
    });

    if (finalDecision.action === "ESCALATE") {
      await escalate(org, conv, message.id, finalDecision.reasons, safeReply || null, run.id, {
        citations,
        confidence,
      });
    }
    if (finalDecision.action === "SEND" && followUpHours && resolution === "in_progress") {
      await scheduleFollowUp({
        orgId: org.id,
        conversationId: conv.id,
        kind: "CHECK_IN",
        dueAt: new Date(Date.now() + followUpHours * 3600_000),
        reason: "Agent suggested check-in",
        createdBy: "AI",
      }).catch((e) => log("follow_up_not_scheduled", errorMessage(e)));
    }

    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: finalDecision.action === "SUPERSEDED" ? "SUPERSEDED" : "COMPLETED",
        decision: finalDecision.action,
        intent: classification.intent,
        urgency: classification.urgency,
        language: classification.language,
        confidence,
        reasons: finalDecision.reasons,
        citations: citations as unknown as Prisma.InputJsonValue,
        steps: steps as unknown as Prisma.InputJsonValue,
        provider: providerLabel,
        model: modelName,
        inputTokens,
        outputTokens,
        costUsd: await runCost(run.id),
        latencyMs: Date.now() - started,
        error: null,
      },
    });

    const total = await prisma.message.count({ where: { conversationId: conv.id } });
    if (total % 6 === 0) {
      await enqueue(
        "summarize_conversation",
        { conversationId: conv.id },
        { orgId: org.id, dedupeKey: `summary:${conv.id}:${total}` },
      );
    }
    return finalDecision.action === "SUPERSEDED"
      ? { status: "SKIPPED", reason: "control_changed_during_run" }
      : { status: "COMPLETED", decision: finalDecision, agentRunId: run.id };
  } catch (err) {
    const msg = errorMessage(err);
    if (err instanceof NoProviderAvailableError && opts.attempt < opts.maxAttempts) {
      // Keep the message and retry later; the job queue applies exponential backoff.
      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "RETRYING",
          error: msg.slice(0, 1000),
          steps: steps as unknown as Prisma.InputJsonValue,
        },
      });
      return { status: "RETRY", reason: msg };
    }
    logger.error(
      { orgId: org.id, conversationId: conv.id, err: msg },
      "Agent run failed; escalating to a human",
    );
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        decision: "ESCALATE",
        error: msg.slice(0, 1000),
        steps: steps as unknown as Prisma.InputJsonValue,
        latencyMs: Date.now() - started,
        inputTokens,
        outputTokens,
      },
    });
    await escalate(
      org,
      conv,
      message.id,
      [err instanceof NoProviderAvailableError ? "ai_unavailable" : "agent_error"],
      null,
      run.id,
    );
    return {
      status: "COMPLETED",
      decision: { action: "ESCALATE", reasons: ["agent_error"] },
      agentRunId: run.id,
    };
  }
}

async function runCost(agentRunId: string): Promise<number | null> {
  const agg = await prisma.usageRecord.aggregate({ where: { agentRunId }, _sum: { costUsd: true } });
  return agg._sum.costUsd ?? null;
}

async function recordSkip(
  orgId: string,
  conversationId: string,
  triggerMessageId: string,
  reason: string,
): Promise<ProcessOutcome> {
  await prisma.agentRun
    .upsert({
      where: { triggerMessageId },
      create: { orgId, conversationId, triggerMessageId, status: "SKIPPED", reasons: [reason] },
      update: { status: "SKIPPED", reasons: [reason] },
    })
    .catch(() => undefined);
  return { status: "SKIPPED", reason };
}

/**
 * Hands the conversation to humans: AI replies pause (control = PENDING_HUMAN), the customer gets the
 * configured holding message (a fixed text, not AI-generated), the AI's draft (if any) is kept for
 * the human to review, a reminder is scheduled and an event is emitted.
 */
async function escalate(
  org: Organization,
  conv: Conversation,
  triggerMessageId: string,
  reasons: string[],
  draft: string | null,
  agentRunId: string | null,
  meta: Record<string, unknown> = {},
) {
  const changed = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<Pick<Conversation, "control" | "status">>>`
      SELECT "control", "status" FROM "Conversation" WHERE "id" = ${conv.id} FOR UPDATE`;
    if (!locked || locked.control === "HUMAN") return false;
    const alreadyEscalated = locked.control === "PENDING_HUMAN";
    await tx.conversation.update({
      where: { id: conv.id },
      data: {
        control: "PENDING_HUMAN",
        status: "ESCALATED",
        ...(alreadyEscalated ? {} : { controlVersion: { increment: 1 } }),
      },
    });
    if (draft) {
      await queueOutbound(tx, {
        orgId: org.id,
        conversationId: conv.id,
        channelId: conv.channelId,
        authorType: "AI",
        payload: { type: "text", text: draft },
        agentRunId,
        status: "PENDING_APPROVAL",
        metadata: { ...meta, suggestion: true, reasons },
      });
    }
    if (!alreadyEscalated) {
      // The holding message is a fixed, administrator-written text. In copilot mode it also needs approval.
      await queueOutbound(tx, {
        orgId: org.id,
        conversationId: conv.id,
        channelId: conv.channelId,
        authorType: "SYSTEM",
        payload: { type: "text", text: org.escalationMessage },
        status: org.autonomyMode === "COPILOT" ? "PENDING_APPROVAL" : "QUEUED",
        metadata: { holdingMessage: true },
      });
    }
    await tx.auditLog.create({
      data: {
        orgId: org.id,
        actorType: "AI",
        action: "conversation.escalated",
        targetType: "conversation",
        targetId: conv.id,
        metadata: { reasons, triggerMessageId },
      },
    });
    return !alreadyEscalated;
  });
  if (!changed) return;
  await emitEvent(org.id, "conversation.escalated", { conversation_id: conv.id, reasons });
  await scheduleFollowUp({
    orgId: org.id,
    conversationId: conv.id,
    kind: "ESCALATION_REMINDER",
    dueAt: new Date(Date.now() + 30 * 60_000),
    reason: reasons.join(", "),
    createdBy: "SYSTEM",
  }).catch(() => undefined);
}

async function handleOptOut(
  org: Organization,
  conv: Conversation & { customer: { id: string } },
  triggerMessageId: string,
) {
  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: conv.customer.id },
      data: { optedOut: true, optedOutAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        orgId: org.id,
        actorType: "SYSTEM",
        action: "customer.opted_out",
        targetType: "customer",
        targetId: conv.customer.id,
      },
    });
    await queueOutbound(tx, {
      orgId: org.id,
      conversationId: conv.id,
      channelId: conv.channelId,
      authorType: "SYSTEM",
      payload: {
        type: "text",
        text: `You have been unsubscribed and won't receive further messages from ${org.name}. Reply ${org.optInKeywords[0] ?? "START"} to subscribe again.`,
      },
      metadata: { optOutConfirmation: true },
    });
    await tx.agentRun.upsert({
      where: { triggerMessageId },
      create: {
        orgId: org.id,
        conversationId: conv.id,
        triggerMessageId,
        status: "HANDLED",
        decision: "OPT_OUT",
      },
      update: { status: "HANDLED", decision: "OPT_OUT" },
    });
  });
  await cancelCustomerFollowUps(org.id, conv.customer.id, "Customer opted out");
}

/** Job handler: refreshes the stored conversation summary. */
export async function summarizeConversation(conversationId: string) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) return;
  const messages = await prisma.message.findMany({
    where: { conversationId, status: { notIn: ["PENDING_APPROVAL", "REJECTED", "SUPERSEDED"] } },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  messages.reverse();
  const transcript = messages
    .map(
      (m) =>
        `${m.direction === "INBOUND" ? "Customer" : m.authorType === "HUMAN" ? "Agent" : "Assistant"}: ${m.body ?? `[${m.type}]`}`,
    )
    .join("\n");
  const router = await AIRouter.forOrg(conv.orgId);
  if (!router.hasProvider) return;
  const routed = await router.run("summary", async (p) => {
    const r = await p.summarizeConversation({ transcript });
    return { value: r.result, response: r.response };
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { summary: routed.value.summary.slice(0, 2000) },
  });
}
