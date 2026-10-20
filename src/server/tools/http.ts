import type { ToolConfig } from "@prisma/client";
import { z } from "zod";
import { decryptSecret } from "../security/crypto";
import { safeFetch } from "../security/ssrf";
import { httpToolSchemaValidator, jsonSchemaToZod, type HttpToolSchema } from "./jsonSchemaToZod";
import type { BuiltinToolDefinition } from "./types";

export const httpToolConfigSchema = z.object({
  method: z.enum(["GET", "POST"]),
  /** e.g. https://api.example.com/orders/{order_id}  — placeholders are URL-encoded input values. */
  urlTemplate: z.string().url().max(500),
  headers: z.record(z.string().regex(/^[A-Za-z0-9-]{1,64}$/), z.string().max(500)).default({}),
  /** Header that carries the encrypted secret, e.g. "Authorization" (value "Bearer …" is stored as the secret). */
  authHeaderName: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/)
    .optional(),
  inputSchema: httpToolSchemaValidator,
  /** Optional dot-path to the part of the JSON response returned to the model, e.g. "data.order". */
  responsePath: z
    .string()
    .regex(/^[A-Za-z0-9_.]{0,100}$/)
    .optional(),
  /** Pass the customer's WhatsApp number as a query/body parameter with this name (bound server-side). */
  customerIdParam: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,40}$/)
    .optional(),
});
export type HttpToolConfig = z.infer<typeof httpToolConfigSchema>;

function pick(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  return path
    .split(".")
    .reduce<unknown>(
      (acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
      obj,
    );
}

/** Builds a tool definition for an administrator-configured REST API or webhook call. */
export function httpToolDefinition(cfg: ToolConfig): BuiltinToolDefinition | null {
  const parsed = httpToolConfigSchema.safeParse(cfg.config);
  if (!parsed.success) return null;
  const c = parsed.data;
  const input = jsonSchemaToZod(c.inputSchema as HttpToolSchema);
  return {
    name: cfg.name,
    description: cfg.description,
    permission: cfg.permission,
    input,
    parameters: { ...c.inputSchema, additionalProperties: false },
    timeoutMs: cfg.timeoutMs,
    needsConversation: !!c.customerIdParam,
    async execute(raw, ctx) {
      const args = { ...(raw as Record<string, unknown>) };
      const used = new Set<string>();
      let url = c.urlTemplate.replace(/\{([a-z][a-z0-9_]*)\}/g, (_, key: string) => {
        used.add(key);
        return encodeURIComponent(String(args[key] ?? ""));
      });
      if (c.customerIdParam && ctx.customerId) {
        const { prisma } = await import("../db");
        const customer = await prisma.customer.findFirst({
          where: { id: ctx.customerId, orgId: ctx.orgId },
          select: { waId: true },
        });
        if (customer) args[c.customerIdParam] = customer.waId;
      }
      const rest = Object.fromEntries(Object.entries(args).filter(([k]) => !used.has(k)));
      const headers: Record<string, string> = {
        accept: "application/json",
        "user-agent": "OpenWa-Agent-Tools/1.0",
        ...c.headers,
      };
      if (c.authHeaderName && cfg.encryptedSecret)
        headers[c.authHeaderName] = decryptSecret(cfg.encryptedSecret);
      let body: string | undefined;
      if (c.method === "GET") {
        const u = new URL(url);
        for (const [k, v] of Object.entries(rest)) if (v !== undefined) u.searchParams.set(k, String(v));
        url = u.toString();
      } else {
        headers["content-type"] = "application/json";
        body = JSON.stringify(rest);
      }
      const res = await safeFetch(url, {
        method: c.method,
        headers,
        body,
        timeoutMs: cfg.timeoutMs,
        maxBytes: 256 * 1024,
      });
      const text = res.body.toString("utf8");
      if (res.status === 404) return { found: false, http_status: 404 };
      if (res.status < 200 || res.status >= 300)
        throw new Error(`Upstream API responded with HTTP ${res.status}`);
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        throw new Error("Upstream API did not return JSON");
      }
      const selected = pick(json, c.responsePath);
      if (selected === undefined) return { found: false };
      return selected && typeof selected === "object" && !Array.isArray(selected)
        ? (selected as Record<string, unknown>)
        : { result: selected };
    },
  };
}
