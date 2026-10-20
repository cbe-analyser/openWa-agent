import { z } from "zod";
import { parseQuery, route } from "@/server/http/route";
import { listCustomers } from "@/server/services/customers";

export const GET = route({ auth: "any", permission: "customers:read" }, async (req, { ctx }) =>
  listCustomers(
    ctx,
    parseQuery(
      req,
      z.object({
        q: z.string().max(100).optional(),
        tag: z.string().max(40).optional(),
        cursor: z.string().max(40).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
    ),
  ),
);
