/**
 * Deterministic safety checks that run independently of the language model, so that escalation
 * and output restrictions cannot be talked around by a prompt injection.
 */

export interface InboundFlags {
  wantsHuman: boolean;
  legal: boolean;
  securityIncident: boolean;
  refund: boolean;
  financialTransaction: boolean;
  sensitiveData: boolean;
  abusive: boolean;
  spam: boolean;
  promptInjection: boolean;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export function containsCardNumber(text: string): boolean {
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return true;
  }
  return false;
}

export function detectInbound(text: string): InboundFlags {
  const t = text.toLowerCase();
  return {
    wantsHuman:
      /\b(human|real person|live agent|an agent|customer (care|service) agent|representative|speak (to|with) (someone|somebody|a person)|talk (to|with) (someone|somebody|a person)|manager|supervisor)\b/.test(
        t,
      ),
    legal:
      /\b(lawyer|attorney|advocate|legal action|sue|suing|court|lawsuit|ombudsman|regulator|data protection commissioner|odpc|small claims)\b/.test(
        t,
      ),
    securityIncident:
      /\b(hacked|compromised|unauthori[sz]ed (access|transaction|login|charge|payment)|someone (logged|accessed|used) my|fraud|fraudulent|stolen|phishing|sim swap|identity theft|scammed)\b/.test(
        t,
      ),
    refund: /\b(refund|money back|reimburse|reimbursement)\b/.test(t),
    financialTransaction:
      /\b(chargeback|reverse (the |my )?(payment|transaction)|charged twice|double charged|wire|bank transfer|withdraw(al)?|cancel (the |my )?(payment|transaction))\b/.test(
        t,
      ),
    sensitiveData:
      containsCardNumber(text) ||
      /\b(my )?(password|passcode|pin|otp|one[- ]time code|verification code|cvv|cvc)\s*(is|:|=)\s*\S+/i.test(
        text,
      ) ||
      /\b[A-Z]\d{9}[A-Z]\b/.test(text) || // Kenya KRA PIN format
      /\b(passport|national id|id number)\s*(no\.?|number|is|:)\s*[A-Z0-9]{6,}/i.test(text),
    abusive: /\b(idiot|stupid|f+u+c+k+|shit|bitch|bastard|kill you|i will hurt)\b/.test(t),
    spam: /\b(free money|crypto giveaway|click (this|here) to (win|claim)|you have won|investment opportunity|loan offer)\b/.test(
      t,
    ),
    promptInjection:
      /\b(ignore (all |any )?(previous|prior|above) (instructions|prompts?)|you are now|system prompt|developer mode|reveal (your|the) (instructions|prompt)|act as (an? )?(admin|administrator)|jailbreak)\b/.test(
        t,
      ),
  };
}

export interface OutputIssues {
  asksForSecrets: boolean;
  leaksInstructions: boolean;
  unverifiedClaims: string[];
}

/**
 * Checks a drafted reply before it can be sent:
 *  - never ask customers for passwords, PINs, OTPs, card security codes or API secrets;
 *  - never reveal hidden instructions (a random canary embedded in the system prompt);
 *  - never claim an action happened unless the corresponding tool call actually succeeded.
 */
export function checkOutput(reply: string, succeededTools: Set<string>, canary: string): OutputIssues {
  const unverifiedClaims: string[] = [];
  const claims: Array<[RegExp, (tools: Set<string>) => boolean, string]> = [
    [
      /\b(created|opened|raised|logged|filed|recorded)\b[^.?!]{0,40}\b(ticket|case|complaint)\b/i,
      (s) => s.has("create_ticket") || s.has("record_complaint"),
      "ticket",
    ],
    [
      /\b(ticket|case|complaint)\b[^.?!]{0,30}\b(has been|was|is now)\s+(created|opened|raised|logged|recorded)\b/i,
      (s) => s.has("create_ticket") || s.has("record_complaint"),
      "ticket",
    ],
    [
      /\brefund\b[^.?!]{0,40}\b(processed|issued|approved|completed|sent|initiated)\b/i,
      (s) => [...s].some((n) => n.includes("refund")),
      "refund",
    ],
    [
      /\b(scheduled|set up|booked)\b[^.?!]{0,30}\b(follow[- ]?up|check[- ]?in|reminder)\b/i,
      (s) => s.has("schedule_follow_up"),
      "follow_up",
    ],
    [
      /\bI(?:'ve| have)\s+(?:now\s+)?(fixed|reset|updated|changed|cancelled|canceled|unlocked|reactivated|refunded|credited|upgraded)\b/i,
      (s) => s.size > 0,
      "account_change",
    ],
  ];
  for (const [re, verified, label] of claims)
    if (re.test(reply) && !verified(succeededTools) && !unverifiedClaims.includes(label))
      unverifiedClaims.push(label);

  // Checked per sentence so safety advice ("never share your PIN") is not mistaken for a request.
  const askRe =
    /\b(send|share|provide|give|tell|confirm|enter|type|reply with|what is|what's)\b[^.?!]{0,50}\b(password|passcode|pin|otp|one[- ]time (code|password)|verification code|security code|cvv|cvc|full card number|card number|api key|secret key|private key|seed phrase)\b/i;
  // Negation must govern the request verb itself ("never share", "we will not ask for").
  const negated =
    /\b(never|don't|do not|won't|will not|shouldn't|should not|no one (will|should)|nobody (will|should))\s+(\w+\s+){0,2}(send|share|provide|give|tell|confirm|enter|type|reply|ask)\b/i;
  const asksForSecrets = reply
    .split(/(?<=[.?!])\s+|\n+/)
    .some((sentence) => askRe.test(sentence) && !negated.test(sentence));
  const leaksInstructions =
    reply.includes(canary) ||
    /\b(my (system )?instructions (are|say)|system prompt|<\/?(context|knowledge|source)>)/i.test(reply);
  return { asksForSecrets, leaksInstructions, unverifiedClaims };
}

const OPT_OUT_NORMALIZE = (s: string) =>
  s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z ]/g, "")
    .replace(/\s+/g, " ");

export function matchesKeyword(text: string, keywords: string[]): boolean {
  const t = OPT_OUT_NORMALIZE(text);
  return keywords.some((k) => OPT_OUT_NORMALIZE(k) === t);
}
