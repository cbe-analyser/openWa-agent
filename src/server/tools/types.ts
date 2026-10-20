import type { ToolPermission } from "@prisma/client";
import type { ZodTypeAny } from "zod";
import type { JsonSchema } from "../ai/types";

export interface ToolContext {
  orgId: string;
  conversationId: string | null;
  customerId: string | null;
  agentRunId: string | null;
  actor: "AI" | "USER" | "API";
  actorId: string | null;
}

export interface BuiltinToolDefinition {
  name: string;
  description: string;
  permission: ToolPermission;
  /** Zod schema used to validate model-provided input. */
  input: ZodTypeAny;
  /** JSON Schema advertised to the model. Must describe the same shape as `input`. */
  parameters: JsonSchema;
  timeoutMs: number;
  /** Requires a bound conversation/customer (cannot be called from a context without one). */
  needsConversation: boolean;
  execute(input: unknown, ctx: ToolContext): Promise<Record<string, unknown>>;
}

export type ToolOutcome =
  | { status: "SUCCEEDED"; executionId: string; output: Record<string, unknown> }
  | { status: "FAILED" | "DENIED"; executionId: string | null; error: string }
  | { status: "PENDING_APPROVAL"; executionId: string; message: string };
