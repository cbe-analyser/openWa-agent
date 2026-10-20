import { route } from "@/server/http/route";
import { actorOf } from "@/server/auth/context";
import { cancelFollowUp } from "@/server/services/followups";

export const DELETE = route<{ id: string }>(
  { auth: "any", permission: "followups:write" },
  async (_req, { ctx, params }) => {
    const a = actorOf(ctx);
    await cancelFollowUp(ctx.orgId, params.id, { type: a.actorType as "USER" | "API_KEY", id: a.actorId });
    return { cancelled: true };
  },
);
