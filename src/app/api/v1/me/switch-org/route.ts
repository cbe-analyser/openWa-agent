import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { switchOrganization } from "@/server/services/auth";

export const POST = route({ auth: "session" }, async (req, { ctx }) => {
  const { orgId } = await parseJson(req, z.object({ orgId: z.string().min(1).max(40) }));
  await switchOrganization(ctx, orgId);
  return { ok: true };
});
