# Data protection

> **This is not legal advice.** It explains what OpenWa Agent does with personal data and which features help you meet data-protection duties. Laws, regulations and regulator guidance change; confirm your obligations with a qualified advisor or the regulator.

When you run OpenWa Agent for your business, **you are the data controller** for your customers' data. If you host it for other businesses (multi-tenant mode), you are usually their **data processor** and need a data processing agreement with each. Your AI provider and Meta are further processors or independent controllers depending on their terms.

## What personal data the system processes

| Data                                                           | Source                    | Stored                        |
| -------------------------------------------------------------- | ------------------------- | ----------------------------- |
| WhatsApp number (wa_id), profile name                          | Meta webhook              | Customer record               |
| Message text, media references, timestamps, delivery status    | Meta webhook / your team  | Messages                      |
| Name, email, notes, tags, tickets, follow-ups                  | Your team or the AI tools | Customer, tickets, follow-ups |
| AI classifications, drafts, citations, tool inputs and outputs | Agent runs                | Agent runs, tool executions   |
| Team members' names, emails, IP addresses, user agents         | Sign-in                   | Users, sessions, audit log    |

Message content and knowledge excerpts are **sent to the AI provider you configure** for each reply. Media files stay with Meta and are fetched on demand for staff; they are not sent to the AI.

## Built-in privacy features

| Feature                                                                                                                                                     | Where                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Opt-out and opt-in keywords handled without AI; opted-out customers get no further messages or follow-ups                                                   | AI agent settings                                                        |
| Right of access / portability: export all data for a customer as JSON                                                                                       | Customer page → **Export data** (or `GET /api/v1/customers/{id}/export`) |
| Right to erasure: delete a customer with their conversations, messages, notes, tickets and follow-ups                                                       | Customer page → **Delete all data** (owners only)                        |
| Correction                                                                                                                                                  | Edit customer details on the customer page                               |
| Retention: message content older than N days deleted automatically                                                                                          | AI agent → **Data retention (days)**                                     |
| Human review instead of fully automated replies                                                                                                             | Copilot and Supervised modes; customers can ask for a human at any time  |
| Sensitive data detection: card numbers, national ID/KRA PIN-like values, passwords and codes trigger escalation; the AI is instructed never to ask for them | Always on                                                                |
| Encryption of credentials at rest; HTTPS in transit                                                                                                         | [threat-model.md](threat-model.md)                                       |
| Audit log of access-relevant actions (exports, deletions, takeovers, settings changes)                                                                      | Audit log                                                                |
| Least-privilege roles (owner, admin, agent, viewer) and scoped API keys                                                                                     | Team, Developer API                                                      |
| Choice of AI provider, including self-hosted models so no message leaves your infrastructure                                                                | AI providers                                                             |

## Kenya Data Protection Act, 2019: checklist

The Act applies to processing by controllers and processors established or processing data in Kenya, and to processing of data of people in Kenya. Key points to check for a WhatsApp support deployment:

- [ ] **Registration with the ODPC.** Data controllers and processors above the thresholds in the Data Protection (Registration of Data Controllers and Data Processors) Regulations, 2021, and those in listed sectors, must register with the Office of the Data Protection Commissioner. Check whether your organization is required to.
- [ ] **Lawful basis and purpose.** Document why you process customer support data (typically performance of a contract or legitimate interest) and use it only for that purpose. Use templates for marketing only with consent, and honour opt-outs (direct marketing rules).
- [ ] **Transparency.** Tell customers, for example in your first automated message or a linked privacy notice, that an automated assistant answers, what data you collect, which AI provider processes it, how long you keep it and how to reach a human.
- [ ] **Data subject rights.** Customers may request access, correction, deletion, objection to processing and portability. Use the export and delete functions and record requests and responses. The Act also gives people rights regarding decisions based solely on automated processing that significantly affect them; keep escalation to a human available.
- [ ] **Sensitive personal data** (for example health, biometric, financial details in some contexts) needs extra safeguards. Keep sensitive-data escalation on and avoid collecting it over WhatsApp.
- [ ] **Data protection impact assessment (DPIA).** Processing likely to result in high risk, which can include large-scale automated processing and new technology such as AI, requires a DPIA before you start. Use [threat-model.md](threat-model.md) and this page as inputs.
- [ ] **Data protection by design and default.** Configure retention, least-privilege roles, Copilot or Supervised mode at launch, and the minimum knowledge needed.
- [ ] **Security safeguards.** Follow the hardening checklist in [deployment.md](deployment.md#hardening-checklist) and back up securely.
- [ ] **Breach notification.** Notify the Data Protection Commissioner within **72 hours** of becoming aware of a breach that poses a real risk to data subjects, and inform affected people within a reasonable time unless an exception applies. Processors must notify the controller without delay. Have a contact list and use the audit log and server logs to investigate.
- [ ] **Cross-border transfers.** Hosted AI providers and Meta may process data outside Kenya. Transfers need appropriate safeguards or another legal basis under the Act and its regulations; check your provider's data-processing terms and regions, or use a self-hosted model and host in-country.
- [ ] **Retention.** Keep personal data only as long as necessary. Set a retention period and document it.
- [ ] **Processors.** Have written agreements with your hosting provider, AI provider and, if applicable, the operator of a multi-tenant installation.

Official sources: the Office of the Data Protection Commissioner, <https://www.odpc.go.ke/>, and the Act and regulations published by the Kenya Law Reform Commission / Kenya Law.

## Other jurisdictions

The same features support GDPR-style regimes (access, erasure, portability, retention, processor choice, human review). Check local rules on automated decision-making, marketing consent and international transfers.
