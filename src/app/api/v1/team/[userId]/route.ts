import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { removeMember, updateMemberRole } from "@/server/services/auth";

type P = { userId: string };

export const PATCH = route<P>(
  { auth: "session", permission: "team:manage" },
  async (req, { ctx, params }) => {
    const { role } = await parseJson(req, z.object({ role: z.enum(["OWNER", "ADMIN", "AGENT", "VIEWER"]) }));
    await updateMemberRole(ctx, params.userId, role);
    return { ok: true };
  },
);

export const DELETE = route<P>(
  { auth: "session", permission: "team:manage" },
  async (_req, { ctx, params }) => {
    await removeMember(ctx, params.userId);
    return { removed: true };
  },
);
