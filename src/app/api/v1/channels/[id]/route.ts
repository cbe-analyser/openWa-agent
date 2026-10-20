import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { deleteChannel, updateChannel } from "@/server/services/settings";

type P = { id: string };

export const PATCH = route<P>(
  { auth: "session", permission: "settings:write" },
  async (req, { ctx, params }) =>
    updateChannel(
      ctx,
      params.id,
      await parseJson(
        req,
        z.object({
          name: z.string().min(1).max(60).optional(),
          status: z.enum(["ACTIVE", "DISABLED"]).optional(),
          phoneNumberId: z
            .string()
            .regex(/^\d{5,30}$/)
            .optional(),
          wabaId: z
            .string()
            .regex(/^\d{5,30}$/)
            .optional(),
          displayPhoneNumber: z.string().max(30).optional(),
          apiVersion: z
            .string()
            .regex(/^v\d{1,3}\.\d$/)
            .optional(),
          accessToken: z.string().min(20).max(1000).optional(),
          appSecret: z.string().min(16).max(200).optional(),
          verifyToken: z.string().min(16).max(200).optional(),
        }),
      ),
    ),
);

export const DELETE = route<P>(
  { auth: "session", permission: "settings:write" },
  async (_req, { ctx, params }) => {
    await deleteChannel(ctx, params.id);
    return { deleted: true };
  },
);
