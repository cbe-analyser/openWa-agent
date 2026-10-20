import { z } from "zod";
import type { IntentDefinition } from "../ai/types";

export interface IntentConfig extends IntentDefinition {
  /** Always hand this intent to a human. */
  escalate?: boolean;
}

export const BUILTIN_INTENTS: IntentConfig[] = [
  {
    name: "information_request",
    description: "General questions about the business, hours, locations, policies",
  },
  { name: "technical_problem", description: "Something is not working; troubleshooting needed" },
  {
    name: "billing_question",
    description: "Questions about invoices, charges, plans or payments (not disputes)",
  },
  {
    name: "payment_dispute",
    description: "Customer disputes a charge, reports double charge or wants a chargeback",
    escalate: true,
  },
  { name: "product_enquiry", description: "Questions about products or services, features, availability" },
  { name: "sales_enquiry", description: "Wants to buy, get a quote, discounts or bulk orders" },
  { name: "complaint", description: "Customer is unhappy and complains about service or product" },
  { name: "refund_request", description: "Customer asks for a refund or money back", escalate: true },
  { name: "account_access", description: "Cannot log in, locked out, password reset, account security" },
  { name: "urgent_incident", description: "Outage, safety issue or time-critical emergency", escalate: true },
  {
    name: "human_authorization_required",
    description:
      "Request that needs a staff decision (exceptions, cancellations of contracts, account changes)",
    escalate: true,
  },
  { name: "order_status", description: "Where is my order, delivery tracking, order changes" },
  { name: "spam_abuse", description: "Spam, scams, abusive or irrelevant messages" },
  { name: "other", description: "Anything else" },
];

export const customIntentSchema = z
  .array(
    z.object({
      name: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
      description: z.string().min(3).max(200),
      escalate: z.boolean().optional(),
    }),
  )
  .max(30);

export function intentsForOrg(customIntents: unknown): IntentConfig[] {
  const parsed = customIntentSchema.safeParse(customIntents);
  const custom = parsed.success ? parsed.data : [];
  const names = new Set(custom.map((c) => c.name));
  return [...BUILTIN_INTENTS.filter((b) => !names.has(b.name)), ...custom];
}

/** Intents whose answers depend on business facts — these must be grounded in the knowledge base or a tool. */
export const BUSINESS_FACT_INTENTS = new Set([
  "information_request",
  "billing_question",
  "product_enquiry",
  "sales_enquiry",
  "order_status",
]);
export const TROUBLESHOOTING_INTENTS = new Set(["technical_problem", "account_access"]);
