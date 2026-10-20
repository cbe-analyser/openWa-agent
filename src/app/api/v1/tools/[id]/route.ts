import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";
import { deleteTool, setToolEnabled, upsertHttpTool } from "@/server/services/settings";

type P = { id: string };

const patch = z.object({
  enabled: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  description: z.string().min(10).max(500).optional(),
  permission: z.enum(["READ", "WRITE", "HIGH_IMPACT"]).optional(),
  timeoutMs: z.number().int().min(1000).max(30000).optional(),
  config: z.unknown().optional(),
  secret: z.string().max(2000).nullable().optional(),
});

export const PATCH = route<P>(
  { auth: "any", permission: "integrations:write" },
  async (req, { ctx, params }) => {
    const b = await parseJson(req, patch);
    const tool = await prisma.toolConfig.findFirst({ where: { id: params.id, orgId: ctx.orgId } });
    if (!tool) throw notFound("Tool");
    if (
      tool.kind === "BUILTIN" ||
      (b.config === undefined &&
        b.description === undefined &&
        b.permission === undefined &&
        b.secret === undefined)
    ) {
      return setToolEnabled(ctx, params.id, { enabled: b.enabled, requiresApproval: b.requiresApproval });
    }
    return upsertHttpTool(
      ctx,
      {
        name: tool.name,
        description: b.description ?? tool.description,
        permission: b.permission ?? tool.permission,
        requiresApproval: b.requiresApproval ?? tool.requiresApproval,
        timeoutMs: b.timeoutMs ?? tool.timeoutMs,
        enabled: b.enabled ?? tool.enabled,
        config: b.config ?? tool.config,
        secret: b.secret,
      },
      tool.id,
    );
  },
);

export const DELETE = route<P>(
  { auth: "any", permission: "integrations:write" },
  async (_req, { ctx, params }) => {
    await deleteTool(ctx, params.id);
    return { deleted: true };
  },
);
