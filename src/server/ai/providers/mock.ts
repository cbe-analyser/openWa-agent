import { BaseProvider } from "./base";
import { ProviderError, type AIRequest, type AIResponse, type ProviderHealth, type ToolCall } from "../types";
import { estimateTokens } from "../json";

/**
 * Deterministic, offline provider for the simulator, local development and automated tests.
 * It is NOT a language model: it uses keyword rules and lexical overlap with the retrieved
 * knowledge passages. It is clearly labelled as a mock everywhere in the UI.
 *
 * settings.simulateOutage = true makes every call fail with a retryable error (fallback testing).
 */
export class MockProvider extends BaseProvider {
  readonly kind = "MOCK" as const;

  protected async chat(input: AIRequest): Promise<AIResponse> {
    const started = Date.now();
    if (this.config.settings.simulateOutage === true) {
      throw new ProviderError("Mock provider simulated outage", true, 503);
    }
    const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
    const lastTurn = input.messages[input.messages.length - 1];
    let text: string;
    let toolCalls: ToolCall[] = [];

    if (input.system.includes("You classify")) {
      text = JSON.stringify(classify(extractTag(lastUser?.content ?? "", "message")));
    } else if (input.system.includes("operational summaries")) {
      const transcript = extractTag(lastUser?.content ?? "", "transcript");
      const lines = transcript.split("\n").filter(Boolean);
      text = JSON.stringify({
        summary: `Conversation with ${lines.length} messages. First: ${(lines[0] ?? "").slice(0, 160)} Latest: ${(lines[lines.length - 1] ?? "").slice(0, 160)}`,
        open_issues: [],
      });
    } else if (lastTurn?.role === "tool") {
      const toolResults = input.messages.filter((m) => m.role === "tool");
      const last = toolResults[toolResults.length - 1] as Extract<typeof lastTurn, { role: "tool" }>;
      const reply = last.isError
        ? "I wasn't able to look that up just now. I've noted your request and a member of our team will follow up."
        : `Here is what I found: ${summarizeToolOutput(last.content)}`;
      text = JSON.stringify({
        reply,
        confidence: last.isError ? 0.3 : 0.85,
        resolution: last.isError ? "needs_human" : "in_progress",
        used_sources: [],
        follow_up_hours: null,
        escalation_reason: last.isError ? "Tool failure" : null,
      });
    } else {
      const content = lastUser?.content ?? "";
      const customerMessage = extractTag(content, "customer_message") || content;
      const orderMatch = customerMessage.match(/order\s*(?:number|no\.?|#)?\s*:?\s*#?([A-Z0-9-]{4,20})/i);
      const toolNames = new Set((input.tools ?? []).map((t) => t.name));
      if (orderMatch && toolNames.has("check_order_status")) {
        toolCalls = [
          { id: `mock_${Date.now()}`, name: "check_order_status", arguments: { order_id: orderMatch[1] } },
        ];
        text = "";
      } else if (/\b(human|agent|person|representative|manager)\b/i.test(customerMessage)) {
        text = JSON.stringify({
          reply: "I understand you'd like to speak with a person. I'm connecting you with our team now.",
          confidence: 0.9,
          resolution: "needs_human",
          used_sources: [],
          follow_up_hours: null,
          escalation_reason: "Customer requested a human",
        });
      } else {
        const best = bestSource(content, customerMessage);
        text = JSON.stringify(
          best
            ? {
                reply: best.snippet,
                confidence: 0.85,
                resolution: "in_progress",
                used_sources: [best.id],
                follow_up_hours: null,
                escalation_reason: null,
              }
            : {
                reply:
                  "Thanks for your message. Could you share a few more details so I can help you correctly?",
                confidence: 0.35,
                resolution: "needs_info",
                used_sources: [],
                follow_up_hours: null,
                escalation_reason: null,
              },
        );
      }
    }

    const promptText = input.system + input.messages.map((m) => ("content" in m ? m.content : "")).join("\n");
    return {
      text,
      toolCalls,
      stopReason: toolCalls.length ? "tool_use" : "end",
      usage: { inputTokens: estimateTokens(promptText), outputTokens: estimateTokens(text) },
      provider: "MOCK",
      model: this.model,
      latencyMs: Date.now() - started,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (this.config.settings.simulateOutage === true) {
      return { ok: false, latencyMs: 0, model: this.model, error: "Simulated outage" };
    }
    return { ok: true, latencyMs: 0, model: this.model };
  }
}

function extractTag(text: string, tag: string): string {
  const m = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1]!.trim() : "";
}

const STOP = new Set(
  "a an and are as at be by can do does for from has have how i in is it its me my of on or our please the to was what when where which who why will with you your hi hello thanks".split(
    " ",
  ),
);

function words(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
}

function bestSource(content: string, question: string): { id: string; snippet: string } | null {
  const q = new Set(words(question));
  if (q.size === 0) return null;
  const re = /<source id="([^"]+)"[^>]*>([\s\S]*?)<\/source>/g;
  let best: { id: string; snippet: string; score: number } | null = null;
  for (const m of content.matchAll(re)) {
    const id = m[1]!;
    const sentences = m[2]!
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (let i = 0; i < sentences.length; i++) {
      const window = sentences.slice(i, i + 2).join(" ");
      const overlap = words(window).filter((w) => q.has(w)).length;
      if (overlap > 0 && (!best || overlap > best.score))
        best = { id, snippet: window.slice(0, 600), score: overlap };
    }
  }
  return best && best.score >= Math.min(2, q.size) ? { id: best.id, snippet: best.snippet } : null;
}

function summarizeToolOutput(raw: string): string {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(obj)
      .filter(([, v]) => v !== null && typeof v !== "object")
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`)
      .join(", ");
  } catch {
    return raw.slice(0, 300);
  }
}

function classify(text: string) {
  const t = text.toLowerCase();
  const rules: Array<[RegExp, string, string]> = [
    [/\b(lawyer|legal action|sue|court|attorney)\b/, "complaint", "HIGH"],
    [/\b(hacked|unauthori[sz]ed|fraud|stolen|breach)\b/, "account_access", "URGENT"],
    [/\b(refund|money back)\b/, "refund_request", "HIGH"],
    [/\b(chargeback|dispute|charged twice|double charged)\b/, "payment_dispute", "HIGH"],
    [/\b(invoice|bill|billing|payment|charge)\b/, "billing_question", "NORMAL"],
    [/\b(login|log in|password|locked out|can't access|cannot access|account)\b/, "account_access", "HIGH"],
    [/\b(outage|down for everyone|emergency|urgent)\b/, "urgent_incident", "URGENT"],
    [/\b(not working|error|broken|bug|crash|issue|problem|fails?)\b/, "technical_problem", "NORMAL"],
    [/\b(complain|terrible|awful|worst|disappointed)\b/, "complaint", "HIGH"],
    [/\b(buy|purchase|quote|discount|pricing for|bulk)\b/, "sales_enquiry", "NORMAL"],
    [/\b(price|cost|product|stock|available|feature)\b/, "product_enquiry", "LOW"],
    [/\b(free money|click here|crypto giveaway|winner)\b/, "spam_abuse", "LOW"],
  ];
  const hit = rules.find(([re]) => re.test(t));
  return {
    intent: hit ? hit[1] : "information_request",
    urgency: hit ? hit[2] : "LOW",
    language: "en",
    sentiment: /\b(angry|terrible|awful|worst|disappointed|unacceptable)\b/.test(t) ? "negative" : "neutral",
    wants_human: /\b(human|agent|person|representative|manager)\b/.test(t),
    confidence: hit ? 0.8 : 0.6,
  };
}
