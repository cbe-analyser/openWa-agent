import type { Prisma, ToolConfig } from "@prisma/client";
import { prisma } from "../db";
import { errorMessage } from "../logger";
import { redact } from "../security/redact";
import { emitEvent } from "../services/events";
import type { ToolSpec } from "../ai/types";
import { builtinTool } from "./builtin";
import { httpToolDefinition } from "./http";
import type { BuiltinToolDefinition, ToolContext, ToolOutcome } from "./types";

const MAX_OUTPUT_CHARS = 6000;

export function definitionFor(cfg: ToolConfig): BuiltinToolDefinition | null {
  if (cfg.kind === "BUILTIN") return builtinTool(cfg.name) ?? null;
  return httpToolDefinition(cfg);
}

/** Tools enabled for an organization, as advertised to the model. */
export async function availableTools(
  orgId: string,
  hasConversation: boolean,
): Promise<{ specs: ToolSpec[]; configs: ToolConfig[] }> {
  const configs = await prisma.toolConfig.findMany({
    where: { orgId, enabled: true },
    orderBy: { name: "asc" },
  });
  const specs: ToolSpec[] = [];
  const usable: ToolConfig[] = [];
  for (const c of configs) {
    const def = definitionFor(c);
    if (!def || (def.needsConversation && !hasConversation)) continue;
    specs.push({ name: c.name, description: c.description || def.description, parameters: def.parameters });
    usable.push(c);
  }
  return { specs, configs: usable };
}

/** Whether a call needs a human decision before it runs. HIGH_IMPACT tools always do. */
export function requiresApproval(cfg: Pick<ToolConfig, "permission" | "requiresApproval">): boolean {
  return cfg.permission === "HIGH_IMPACT" || cfg.requiresApproval;
}

async function runWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tool timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function boundOutput(output: Record<string, unknown>): Record<string, unknown> {
  const s = JSON.stringify(output);
  if (s.length <= MAX_OUTPUT_CHARS) return output;
  return { truncated: true, preview: s.slice(0, MAX_OUTPUT_CHARS) };
}

/**
 * Validates, authorizes, executes and logs a tool call. The organization and conversation come
 * from the server-side context — never from model-provided arguments.
 */
export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
  opts: { skipApproval?: boolean; executionId?: string } = {},
): Promise<ToolOutcome> {
  const cfg = await prisma.toolConfig.findFirst({ where: { orgId: ctx.orgId, name, enabled: true } });
  const def = cfg ? definitionFor(cfg) : null;
  const base = {
    orgId: ctx.orgId,
    agentRunId: ctx.agentRunId,
    conversationId: ctx.conversationId,
    toolName: name,
  };

  if (!cfg || !def) {
    const rec = await prisma.toolExecution.create({
      data: {
        ...base,
        input: redact(rawInput ?? {}) as Prisma.InputJsonValue,
        status: "DENIED",
        error: "Tool is not registered or not enabled",
      },
    });
    return { status: "DENIED", executionId: rec.id, error: `Tool "${name}" is not available` };
  }
  if (def.needsConversation && (!ctx.conversationId || !ctx.customerId)) {
    return { status: "DENIED", executionId: null, error: "Tool requires a conversation" };
  }
  const parsed = def.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const error = `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`;
    const rec = await prisma.toolExecution.create({
      data: { ...base, input: redact(rawInput ?? {}) as Prisma.InputJsonValue, status: "FAILED", error },
    });
    return { status: "FAILED", executionId: rec.id, error };
  }

  if (requiresApproval(cfg) && !opts.skipApproval) {
    const rec = await prisma.toolExecution.create({
      data: { ...base, input: parsed.data as Prisma.InputJsonValue, status: "PENDING_APPROVAL" },
    });
    await emitEvent(ctx.orgId, "tool.approval_requested", {
      execution_id: rec.id,
      tool: name,
      conversation_id: ctx.conversationId,
    });
    return {
      status: "PENDING_APPROVAL",
      executionId: rec.id,
      message: "This action needs approval from a team member before it can be carried out.",
    };
  }

  const started = Date.now();
  try {
    const output = boundOutput(
      await runWithTimeout(def.execute(parsed.data, ctx), cfg.timeoutMs || def.timeoutMs),
    );
    const data = {
      status: (opts.executionId ? "APPROVED" : "SUCCEEDED") as "APPROVED" | "SUCCEEDED",
      output: redact(output) as Prisma.InputJsonValue,
      durationMs: Date.now() - started,
    };
    const rec = opts.executionId
      ? await prisma.toolExecution.update({ where: { id: opts.executionId }, data })
      : await prisma.toolExecution.create({
          data: { ...base, input: redact(parsed.data) as Prisma.InputJsonValue, ...data },
        });
    return { status: "SUCCEEDED", executionId: rec.id, output };
  } catch (err) {
    const error = errorMessage(err).slice(0, 500);
    const data = { status: "FAILED" as const, error, durationMs: Date.now() - started };
    const rec = opts.executionId
      ? await prisma.toolExecution.update({ where: { id: opts.executionId }, data })
      : await prisma.toolExecution.create({
          data: { ...base, input: redact(parsed.data) as Prisma.InputJsonValue, ...data },
        });
    return { status: "FAILED", executionId: rec.id, error };
  }
}

/** A human approves or rejects a pending high-impact tool call. */
export async function decideToolExecution(
  orgId: string,
  executionId: string,
  approve: boolean,
  userId: string | null,
): Promise<ToolOutcome | null> {
  const exec = await prisma.toolExecution.findFirst({
    where: { id: executionId, orgId, status: "PENDING_APPROVAL" },
  });
  if (!exec) return null;
  await prisma.toolExecution.update({
    where: { id: exec.id },
    data: { decidedById: userId, decidedAt: new Date(), ...(approve ? {} : { status: "REJECTED" }) },
  });
  await prisma.auditLog.create({
    data: {
      orgId,
      actorType: "USER",
      actorId: userId,
      action: approve ? "tool.approved" : "tool.rejected",
      targetType: "tool_execution",
      targetId: exec.id,
      metadata: { tool: exec.toolName },
    },
  });
  if (!approve) return null;
  const conv = exec.conversationId
    ? await prisma.conversation.findFirst({ where: { id: exec.conversationId, orgId } })
    : null;
  return executeTool(
    exec.toolName,
    exec.input,
    {
      orgId,
      conversationId: conv?.id ?? null,
      customerId: conv?.customerId ?? null,
      agentRunId: exec.agentRunId,
      actor: "USER",
      actorId: userId,
    },
    { skipApproval: true, executionId: exec.id },
  );
}
