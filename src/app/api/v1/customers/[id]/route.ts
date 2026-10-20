import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { deleteCustomerData, getCustomer, updateCustomer } from "@/server/services/customers";

type P = { id: string };

export const GET = route<P>({ auth: "any", permission: "customers:read" }, async (_req, { ctx, params }) =>
  getCustomer(ctx, params.id),
);

export const PATCH = route<P>(
  { auth: "session", permission: "customers:write" },
  async (req, { ctx, params }) => {
    const b = await parseJson(
      req,
      z.object({
        name: z.string().max(100).nullable().optional(),
        email: z.string().email().max(254).nullable().optional(),
        tags: z.array(z.string().max(40)).max(30).optional(),
        externalRef: z.string().max(100).nullable().optional(),
        timezone: z.string().max(60).nullable().optional(),
        optedOut: z.boolean().optional(),
      }),
    );
    return updateCustomer(ctx, params.id, b);
  },
);

/** Right to erasure. Owner-only (data:delete). */
export const DELETE = route<P>(
  { auth: "session", permission: "data:delete" },
  async (_req, { ctx, params }) => {
    await deleteCustomerData(ctx, params.id);
    return { deleted: true };
  },
);
