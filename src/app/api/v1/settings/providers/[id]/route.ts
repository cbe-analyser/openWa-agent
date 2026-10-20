import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { deleteProvider, updateProvider } from "@/server/services/settings";
import { providerFields } from "../../_lib/providerFields";

type P = { id: string };

export const PATCH = route<P>(
  { auth: "session", permission: "settings:write" },
  async (req, { ctx, params }) =>
    updateProvider(ctx, params.id, await parseJson(req, z.object(providerFields).partial())),
);

export const DELETE = route<P>(
  { auth: "session", permission: "settings:write" },
  async (_req, { ctx, params }) => {
    await deleteProvider(ctx, params.id);
    return { deleted: true };
  },
);
