import { z } from "zod";
import { prisma } from "../db";
import { getRetriever } from "../knowledge/retrieval";
import { emitEvent } from "../services/events";
import { scheduleFollowUp } from "../services/followups";
import type { BuiltinToolDefinition, ToolContext } from "./types";

function bound(ctx: ToolContext) {
  if (!ctx.conversationId || !ctx.customerId) throw new Error("This tool requires a conversation context");
  return { conversationId: ctx.conversationId, customerId: ctx.customerId };
}

const priority = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL");

export const BUILTIN_TOOLS: BuiltinToolDefinition[] = [
  {
    name: "search_knowledge",
    description:
      "Search the business's approved knowledge base (policies, FAQs, product and troubleshooting documents). Returns relevant passages with source ids.",
    permission: "READ",
    input: z.object({ query: z.string().min(2).max(300) }).strict(),
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What to look up", maxLength: 300 } },
      required: ["query"],
      additionalProperties: false,
    },
    timeoutMs: 10_000,
    needsConversation: false,
    async execute(input, ctx) {
      const { query } = input as { query: string };
      const res = await getRetriever().search(ctx.orgId, query, 4);
      return {
        sufficient_evidence: res.sufficientEvidence,
        passages: res.chunks.map((c) => ({
          source_id: c.chunkId,
          document: c.documentTitle,
          text: c.content.slice(0, 1200),
        })),
      };
    },
  },
  {
    name: "get_customer_profile",
    description:
      "Get the current customer's profile and their open support tickets. Only returns data for the customer in this conversation.",
    permission: "READ",
    input: z.object({}).strict(),
    parameters: { type: "object", properties: {}, additionalProperties: false },
    timeoutMs: 5_000,
    needsConversation: true,
    async execute(_input, ctx) {
      const { customerId } = bound(ctx);
      const c = await prisma.customer.findFirst({
        where: { id: customerId, orgId: ctx.orgId },
        include: {
          tickets: {
            where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] } },
            take: 5,
            orderBy: { createdAt: "desc" },
          },
        },
      });
      if (!c) throw new Error("Customer not found");
      return {
        name: c.name ?? c.profileName,
        tags: c.tags,
        customer_since: c.createdAt.toISOString().slice(0, 10),
        open_tickets: c.tickets.map((t) => ({ number: t.number, subject: t.subject, status: t.status })),
      };
    },
  },
  {
    name: "create_ticket",
    description:
      "Create a support ticket for the current customer so the team can track an issue that needs follow-up work.",
    permission: "WRITE",
    input: z
      .object({
        subject: z.string().min(3).max(150),
        description: z.string().max(2000).default(""),
        category: z.string().min(2).max(50).default("general"),
        priority,
      })
      .strict(),
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", maxLength: 150 },
        description: { type: "string", maxLength: 2000 },
        category: { type: "string", description: "e.g. technical, billing, delivery, account" },
        priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
      },
      required: ["subject"],
      additionalProperties: false,
    },
    timeoutMs: 5_000,
    needsConversation: true,
    async execute(input, ctx) {
      const { conversationId, customerId } = bound(ctx);
      const i = input as {
        subject: string;
        description: string;
        category: string;
        priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
      };
      const ticket = await prisma.ticket.create({
        data: {
          orgId: ctx.orgId,
          conversationId,
          customerId,
          subject: i.subject,
          description: i.description,
          category: i.category,
          priority: i.priority,
          source: "AI",
        },
      });
      await emitEvent(ctx.orgId, "ticket.created", {
        ticket_id: ticket.id,
        number: ticket.number,
        source: "AI",
      });
      return { ticket_number: ticket.number, status: ticket.status };
    },
  },
  {
    name: "get_ticket_status",
    description: "Look up the status of one of the current customer's support tickets by ticket number.",
    permission: "READ",
    input: z.object({ ticket_number: z.coerce.number().int().positive() }).strict(),
    parameters: {
      type: "object",
      properties: { ticket_number: { type: "integer" } },
      required: ["ticket_number"],
      additionalProperties: false,
    },
    timeoutMs: 5_000,
    needsConversation: true,
    async execute(input, ctx) {
      const { customerId } = bound(ctx);
      const t = await prisma.ticket.findFirst({
        where: { orgId: ctx.orgId, customerId, number: (input as { ticket_number: number }).ticket_number },
      });
      if (!t) return { found: false };
      return {
        found: true,
        ticket_number: t.number,
        subject: t.subject,
        status: t.status,
        updated_at: t.updatedAt.toISOString(),
      };
    },
  },
  {
    name: "record_complaint",
    description:
      "Formally record a customer complaint (creates a high-priority complaint ticket for the team).",
    permission: "WRITE",
    input: z.object({ summary: z.string().min(5).max(1000) }).strict(),
    parameters: {
      type: "object",
      properties: { summary: { type: "string", maxLength: 1000 } },
      required: ["summary"],
      additionalProperties: false,
    },
    timeoutMs: 5_000,
    needsConversation: true,
    async execute(input, ctx) {
      const { conversationId, customerId } = bound(ctx);
      const summary = (input as { summary: string }).summary;
      const ticket = await prisma.ticket.create({
        data: {
          orgId: ctx.orgId,
          conversationId,
          customerId,
          subject: `Complaint: ${summary.slice(0, 100)}`,
          description: summary,
          category: "complaint",
          priority: "HIGH",
          source: "AI",
        },
      });
      await emitEvent(ctx.orgId, "ticket.created", {
        ticket_id: ticket.id,
        number: ticket.number,
        source: "AI",
        category: "complaint",
      });
      return { ticket_number: ticket.number, recorded: true };
    },
  },
  {
    name: "schedule_follow_up",
    description:
      "Schedule a check-in with this customer after a delay (1–72 hours) to confirm their issue is resolved. Only use when the customer agreed or the issue is pending.",
    permission: "WRITE",
    input: z.object({ hours: z.number().min(1).max(72), reason: z.string().min(3).max(300) }).strict(),
    parameters: {
      type: "object",
      properties: {
        hours: { type: "number", minimum: 1, maximum: 72 },
        reason: { type: "string", maxLength: 300 },
      },
      required: ["hours", "reason"],
      additionalProperties: false,
    },
    timeoutMs: 5_000,
    needsConversation: true,
    async execute(input, ctx) {
      const { conversationId } = bound(ctx);
      const i = input as { hours: number; reason: string };
      const f = await scheduleFollowUp({
        orgId: ctx.orgId,
        conversationId,
        kind: "CHECK_IN",
        dueAt: new Date(Date.now() + i.hours * 3600_000),
        reason: i.reason,
        createdBy: "AI",
      });
      return { scheduled: true, due_at: f.dueAt.toISOString(), follow_up_id: f.id };
    },
  },
];

export function builtinTool(name: string) {
  return BUILTIN_TOOLS.find((t) => t.name === name);
}
