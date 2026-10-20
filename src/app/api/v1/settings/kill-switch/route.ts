import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { setInstanceKillSwitch } from "@/server/services/settings";
import { isGlobalKillSwitchOn } from "@/server/services/system";

export const GET = route({ auth: "session" }, async () => ({ on: await isGlobalKillSwitchOn() }));

/** Instance-wide emergency stop for every organization (instance administrators only). */
export const POST = route({ auth: "session" }, async (req, { ctx }) => {
  const { on } = await parseJson(req, z.object({ on: z.boolean() }));
  await setInstanceKillSwitch(ctx, on);
  return { on: await isGlobalKillSwitchOn() };
});
