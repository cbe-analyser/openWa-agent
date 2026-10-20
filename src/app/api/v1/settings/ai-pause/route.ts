import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { setOrgAiPaused } from "@/server/services/settings";

/** Organization-wide pause of all AI-generated replies. */
export const POST = route({ auth: "session", permission: "settings:write" }, async (req, { ctx }) => {
  const { paused } = await parseJson(req, z.object({ paused: z.boolean() }));
  await setOrgAiPaused(ctx, paused);
  return { paused };
});
