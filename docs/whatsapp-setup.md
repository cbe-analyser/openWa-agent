# WhatsApp setup

OpenWa Agent connects only through Meta's official **WhatsApp Business Platform (Cloud API)**. It does not use WhatsApp Web, QR-code sessions, browser automation or unofficial libraries, and it cannot read personal WhatsApp chats.

> Meta's screens and requirements change. The steps below describe the general flow; follow Meta's current documentation where it differs: <https://developers.facebook.com/docs/whatsapp/cloud-api/get-started>.

## What you need

- A Meta (Facebook) business portfolio, verified if you want higher messaging limits.
- A phone number that can receive an SMS or voice call for verification and is **eligible for the Cloud API**. A number already registered on the WhatsApp or WhatsApp Business app must first be migrated or deleted from the app, or used with Meta's coexistence feature if your account qualifies. Check Meta's current rules before you move a number that customers already use.
- OpenWa Agent reachable over **public HTTPS** (see [deployment.md](deployment.md)). Meta does not deliver webhooks to `localhost` or plain HTTP.

## 1. Create the Meta app

1. Go to <https://developers.facebook.com/apps> and create an app of type **Business**.
2. Add the **WhatsApp** product. Meta creates a WhatsApp Business Account (WABA) and a test number.
3. Under **WhatsApp → API Setup** note the **Phone number ID** and the **WhatsApp Business Account ID**.
4. Add and verify your real business phone number when you are ready to go live.

## 2. Create a permanent access token

Temporary tokens from the API Setup page expire after about 24 hours. For production:

1. In **Business settings → Users → System users**, create a system user (Admin role).
2. Assign the app and the WhatsApp Business Account to it with full control.
3. Generate a token with the permissions `whatsapp_business_messaging` and `whatsapp_business_management`, and no expiry.

Treat this token like a password. You will paste it only into the OpenWa Agent dashboard, where it is encrypted with `ENCRYPTION_KEY`. Never put it in `.env`, source code, tickets or chat.

## 3. Note the app secret

In the Meta app, **App settings → Basic → App secret**. OpenWa Agent uses it to verify the `X-Hub-Signature-256` header of every webhook, so forged requests are rejected.

## 4. Add the connection in OpenWa Agent

1. Open **WhatsApp connections → Connect WhatsApp number**.
2. Enter the phone number ID, WABA ID, display number, the access token and the app secret. Choose a **verify token**: any random string of at least 16 characters (the wizard can generate one).
3. Save. The page shows the **callback URL**, which looks like `https://support.example.com/api/webhooks/whatsapp/{connectionId}`.
4. Click **Check health**. It calls the Graph API with your token and shows the number's verified name and quality rating, or the exact error.

## 5. Configure the webhook in Meta

1. In the Meta app, **WhatsApp → Configuration → Webhook → Edit**.
2. Paste the callback URL and the verify token, then **Verify and save**. Meta calls the URL with `hub.challenge`; OpenWa Agent answers only if the token matches.
3. Under **Webhook fields**, subscribe to **messages**. This delivers incoming messages and delivery status updates.
4. Send a WhatsApp message to the number from your own phone. It should appear in the **Inbox** within seconds.

If nothing arrives, see [troubleshooting.md](troubleshooting.md#no-messages-arrive).

## Message templates

Outside the 24-hour customer service window (24 hours after the customer's last message), WhatsApp only allows **pre-approved templates**. OpenWa Agent enforces this: free-form replies outside the window are blocked, and a follow-up due outside the window is sent with the follow-up template you configure in **AI agent** settings (or skipped, with the reason recorded, if none is set).

- **WhatsApp connections → Templates** lists the templates on your WABA with their approval status.
- You can submit a new template there; Meta reviews it, usually within minutes to a day.
- Marketing templates require the customer's opt-in. Customers who send an opt-out keyword (configurable, e.g. `STOP`) are not messaged again until they opt back in.

## Rotating credentials

Use **Update credentials** on the connection card to replace the access token, app secret or verify token. The new values are encrypted and take effect immediately. If you change the verify token, update it in Meta as well. See [operations.md](operations.md#credential-rotation).

## What the official API can and cannot do

| Can                                                                 | Cannot                                                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Receive messages sent to your business number after it is connected | Read past chats or import history from a phone                                           |
| Send replies within 24 hours of the customer's last message         | Message customers freely outside that window (templates only)                            |
| Send templates, buttons, lists, images, documents, audio and video  | Read personal or group chats                                                             |
| Report sent, delivered, read and failed statuses                    | Use the number on the WhatsApp Business app at the same time, unless coexistence applies |
| Mark messages as read                                               | Exceed your messaging tier limits and Meta's quality-rating rules                        |

Meta charges per conversation or per message depending on the category and the customer's country. Check Meta's current pricing; OpenWa Agent does not track Meta charges.

## Trying it without Meta

Use the **Simulator** channel (created automatically in sandbox mode, or added under WhatsApp connections). It runs the same pipeline (agent, policy, handoff, delivery statuses) without any Meta account.
