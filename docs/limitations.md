# Limitations

This page lists what OpenWa Agent does not do, so you can decide whether it fits before you deploy it.

## WhatsApp platform limits

- **Only the official Cloud API.** No WhatsApp Web, QR-code sessions, browser automation or unofficial libraries. These are not planned.
- **No history import.** The API delivers only messages sent to your business number after the webhook is connected. Past chats on a phone cannot be read.
- **24-hour service window.** Free-form messages are only allowed within 24 hours of the customer's last message. After that, only approved templates can be sent.
- **Number eligibility.** Using a number that is on the WhatsApp Business app depends on Meta's migration and coexistence rules.
- **Messaging limits and quality rating** are set by Meta. OpenWa Agent shows the quality rating but cannot raise limits.
- **Groups, calls, status updates and personal accounts** are not supported by the API.
- **Meta charges** are not tracked in the usage page.

## Product limits in this version (0.1.0)

- **One channel type in production:** WhatsApp Cloud API. The simulator is for testing. The adapter interface allows more channels, but none are included.
- **Media:** inbound images, documents, audio and video are stored as references and can be viewed by staff. The AI reads text and captions only: no image understanding, OCR or speech-to-text.
- **Voice notes** reach the inbox and can be played by staff, but the AI only sees "[audio message]". Depending on the model it asks the customer to type or the conversation needs a human.
- **Knowledge formats:** PDF (text layer only, no OCR for scanned PDFs), DOCX, TXT, Markdown, CSV and public web pages (single page, no crawling, no JavaScript rendering). Original files are not kept, only extracted text.
- **Default embeddings are lexical.** Without a configured embedding model, search matches words rather than meaning. Configure an OpenAI-compatible or Ollama embedding model for semantic search.
- **Languages:** the agent replies in the customer's language when the model can. Deterministic safety checks (sensitive-data, legal and abuse detectors) use English patterns; other languages rely more on the model. Opt-out and opt-in keywords are configurable, so you can add keywords in any language.
- **Authentication:** email and password with lockout. No SSO/SAML, no two-factor authentication yet.
- **Real-time updates** use polling (every 4–5 seconds in the inbox), not WebSockets.
- **Analytics** are computed from stored data on request; very large installations may want a reporting replica.
- **Single region.** No built-in high availability; use PostgreSQL replication and several app/worker containers if you need it.
- **Cost figures are estimates** from configured or built-in prices.
- **No billing or subscription management** for hosted multi-tenant use.

## AI behaviour

- Language models can still be wrong. Grounding checks, escalation rules and output checks reduce risk but do not remove it. Start in Copilot or Supervised mode and review the AI's work in the conversation view before enabling Autonomous mode.
- The mock provider is a keyword-rule simulator, not a language model. It exists for demos and tests.
- Small self-hosted models are noticeably weaker at tool use and structured output; expect more drafts and escalations.

## Testing gaps

See [testing.md](testing.md#what-is-not-covered-by-automated-tests).
