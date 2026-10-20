import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { getOrgSettings, updateOrgSettings } from "@/server/services/settings";

const body = z.object({
  name: z.string().min(2).max(100).optional(),
  agentName: z.string().min(1).max(60).optional(),
  businessDescription: z.string().max(3000).optional(),
  agentInstructions: z.string().max(6000).optional(),
  autonomyMode: z.enum(["COPILOT", "SUPERVISED", "AUTONOMOUS"]).optional(),
  confidenceThreshold: z.number().min(0.3).max(0.99).optional(),
  maxTroubleshootTurns: z.number().int().min(1).max(10).optional(),
  autoReplyIntents: z.array(z.string().max(64)).max(40).optional(),
  customIntents: z
    .array(z.object({ name: z.string(), description: z.string(), escalate: z.boolean().optional() }))
    .max(30)
    .optional(),
  escalationMessage: z.string().min(10).max(1000).optional(),
  timezone: z.string().max(60).optional(),
  optOutKeywords: z.array(z.string().min(2).max(30)).max(10).optional(),
  optInKeywords: z.array(z.string().min(2).max(30)).max(10).optional(),
  followUpTemplateName: z
    .string()
    .regex(/^[a-z0-9_]{1,512}$/)
    .nullable()
    .optional(),
  followUpTemplateLang: z.string().max(15).optional(),
  retentionDays: z.number().int().min(7).max(3650).nullable().optional(),
});

export const GET = route({ auth: "session", permission: "settings:read" }, async (_req, { ctx }) =>
  getOrgSettings(ctx),
);
export const PATCH = route({ auth: "session", permission: "settings:write" }, async (req, { ctx }) =>
  updateOrgSettings(ctx, await parseJson(req, body)),
);
