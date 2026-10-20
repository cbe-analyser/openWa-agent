import { NextResponse } from "next/server";
import { route } from "@/server/http/route";
import { exportCustomerData } from "@/server/services/customers";

export const GET = route<{ id: string }>(
  { auth: "session", permission: "data:export" },
  async (_req, { ctx, params }) => {
    const data = await exportCustomerData(ctx, params.id);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="customer-${params.id}.json"`,
      },
    });
  },
);
