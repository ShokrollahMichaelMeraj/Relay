# Relay

**AI-powered wait time intelligence. Turn hold time into a head start.**

Relay is an AI voice agent that activates the moment a customer is placed on hold. Instead of hold music, the customer has a natural conversation. By the time a human agent picks up, they already know who they're talking to, what the problem is, and what's been tried. The customer never repeats themselves.

---

## Table of Contents

- [How It Works](#how-it-works)
- [For Customers (Businesses)](#for-customers-businesses)
- [For Developers](#for-developers)
  - [Prerequisites](#prerequisites)
  - [Quick Start](#quick-start)
  - [Environment Variables](#environment-variables)
  - [Template Configuration](#template-configuration)
  - [CRM Integration](#crm-integration)
  - [API Reference](#api-reference)
- [Voice Configuration](#voice-configuration)
- [Architecture](#architecture)
- [Security & Compliance](#security--compliance)
- [Roadmap](#roadmap)

---

## How It Works

```
  Customer calls support
         │
         ▼
  Placed on hold
         │
         ▼
  Relay activates ──► Natural conversation
         │              • Greets the customer warmly
         │              • Collects issue details
         │              • Offers helpful tips
         │              • Never rushes
         │
         ▼
  Human agent picks up
         │
         ▼
  Agent sees Relay Brief in their CRM ──► Customer's name, issue, steps tried,
                                          emotional tone, suggested next steps
         │
         ▼
  Agent greets customer with context
  "Hi Sarah, I can see you're calling about a billing charge —
   let me pull that up right now."
```

**The result:** Shorter calls. Happier customers. Better-prepared agents.

---

## For Customers (Businesses)

### Who Relay Is For

Relay is built for any company that runs a customer support call centre:

- **Telecoms** — billing disputes, outages, plan changes
- **Banks & insurance** — account issues, claims, fraud reports
- **Utilities** — service outages, billing, meter reads
- **Healthcare admin** — appointment scheduling, billing queries
- **Retail & e-commerce** — returns, orders, delivery issues

### What You Get

**For your customers:**
- No more wasted hold time — they're in a conversation, not limbo
- They never repeat themselves to a human agent
- Helpful tips delivered while they wait (e.g. check the outage map, try the app)

**For your agents:**
- Every call starts with a pre-filled brief — name, issue, what's been tried, emotional state
- Average handle time drops by 20–30%
- First-call resolution improves because agents start informed

**For your managers:**
- Real-time dashboard showing brief quality scores, AHT trends, CSAT correlation
- Call volume breakdown by issue type
- ROI reporting built in

### Pricing

| Plan | Price | Calls/month |
|---|---|---|
| Starter | $999/mo | Up to 5,000 |
| Growth | $2,499/mo | Up to 20,000 |
| Enterprise | Custom | Unlimited + dedicated support |
| Overage | $0.08/call | Above plan limit |

> All plans include Salesforce and Zendesk integrations, the template builder, and the manager dashboard.

### Getting Set Up

1. **Sign up** at [relay.ai](https://relay.ai) and connect your Twilio account
2. **Build your template** — define what information your agents need using the drag-and-drop builder
3. **Configure your hold routing** — a one-line change to your Twilio flow routes hold events to Relay
4. **Connect your CRM** — OAuth connection to Salesforce or Zendesk, takes under 5 minutes
5. **Go live** — Relay activates on the next incoming call

Average setup time: **under 2 hours**.

---

## For Developers

### Prerequisites

- Node.js 20+
- A [Twilio](https://twilio.com) account with a Voice number
- An [OpenAI](https://platform.openai.com) API key with Realtime API access
- Redis 7+ (local or cloud)
- PostgreSQL 15+

### Quick Start

```bash
# Clone the repo
git clone https://github.com/relay-ai/relay
cd relay

# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Run database migrations
npm run db:migrate

# Start the development server
npm run dev
```

Relay will start on `http://localhost:3000`. To test a call locally, use the Twilio CLI to forward a call to your local server via ngrok:

```bash
# Install Twilio CLI and ngrok, then:
ngrok http 3000
twilio phone-numbers:update +1XXXXXXXXXX --voice-url https://your-ngrok-url.ngrok.io/webhooks/twilio/voice
```

### Environment Variables

```bash
# ── Twilio ─────────────────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX

# ── OpenAI ─────────────────────────────────────────────────────────────────
OPENAI_API_KEY=sk-...
OPENAI_REALTIME_MODEL=gpt-4o-realtime-preview
OPENAI_VOICE=nova                        # nova | alloy | echo | fable | onyx | shimmer

# ── Voice behaviour ────────────────────────────────────────────────────────
RELAY_SILENCE_DURATION_MS=800            # How long to wait after customer stops speaking
RELAY_MAX_TURNS=15                       # Max conversation turns before graceful wrap-up
RELAY_MAX_RESPONSE_TOKENS=150            # Keeps responses short and conversational

# ── Redis ──────────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379
REDIS_SESSION_TTL_HOURS=2

# ── Database ───────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@localhost:5432/relay

# ── CRM Integrations ───────────────────────────────────────────────────────
SALESFORCE_CLIENT_ID=your_salesforce_connected_app_id
SALESFORCE_CLIENT_SECRET=your_salesforce_secret
ZENDESK_SUBDOMAIN=yourcompany
ZENDESK_API_TOKEN=your_zendesk_token

# ── App ────────────────────────────────────────────────────────────────────
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
```

### Template Configuration

Templates define what information Relay collects on each call. They live in the database and are managed via the dashboard or API.

**Create a template via the API:**

```bash
curl -X POST https://api.relay.ai/v1/templates \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Billing Inquiry",
    "opening_message": "Hi, I am Relay — while you wait, I can take a few notes so your agent is ready to help the moment they pick up. Would that be okay?",
    "closing_message": "Perfect. An agent will be with you shortly — they will already know what is going on.",
    "fields": [
      {
        "id": "account_id",
        "label": "Account Number",
        "type": "string",
        "required": true,
        "relay_hint": "Ask: do you have your account number handy, or I can look you up by your phone number"
      },
      {
        "id": "issue_type",
        "label": "Issue Type",
        "type": "enum",
        "options": ["unexpected_charge", "payment_failed", "plan_change", "other"],
        "required": true,
        "relay_hint": "Ask naturally: can you tell me a bit about what is going on with your bill today"
      },
      {
        "id": "issue_description",
        "label": "Issue Description",
        "type": "text",
        "required": true,
        "relay_hint": "Let the customer explain in their own words. Do not interrupt."
      },
      {
        "id": "steps_tried",
        "label": "Steps Already Tried",
        "type": "array",
        "required": false,
        "relay_hint": "Ask gently: have you had a chance to look into this already"
      }
    ]
  }'
```

**Assign a template to a phone number:**

```bash
curl -X PATCH https://api.relay.ai/v1/phone-numbers/+1XXXXXXXXXX \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{ "template_id": "tmpl_abc123" }'
```

Different phone numbers can use different templates. A billing line and a technical support line can each collect different information.

### CRM Integration

**Salesforce — connect via OAuth:**

```bash
curl -X POST https://api.relay.ai/v1/integrations/salesforce \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "oauth_code": "YOUR_SALESFORCE_OAUTH_CODE",
    "instance_url": "https://yourorg.salesforce.com",
    "brief_target": "case"        # "case" | "task" | "contact"
  }'
```

**Zendesk — connect via API token:**

```bash
curl -X POST https://api.relay.ai/v1/integrations/zendesk \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "subdomain": "yourcompany",
    "email": "admin@yourcompany.com",
    "api_token": "YOUR_ZENDESK_TOKEN",
    "brief_target": "ticket"
  }'
```

**Generic webhook — for any other CRM:**

```bash
curl -X POST https://api.relay.ai/v1/integrations/webhook \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "url": "https://yourcrm.com/relay-brief",
    "secret": "YOUR_SIGNING_SECRET",
    "headers": { "X-Custom-Header": "value" }
  }'
```

Relay signs all webhook deliveries with `X-Relay-Signature: sha256=...` using your signing secret. Always verify this on your server.

### API Reference

#### Webhooks (inbound — Twilio sends these to Relay)

| Event | Endpoint | Description |
|---|---|---|
| Voice call received | `POST /webhooks/twilio/voice` | Entry point for all inbound calls |
| Hold queue entry | `POST /webhooks/twilio/hold` | Triggers Relay activation |
| Call transferred | `POST /webhooks/twilio/transfer` | Triggers brief generation |
| Call ended | `POST /webhooks/twilio/complete` | Closes session, stores record |

#### REST API (your system calls Relay)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/v1/sessions/:id` | Retrieve a session and its current intake state |
| `GET` | `/v1/briefs/:session_id` | Retrieve the generated brief for a session |
| `GET` | `/v1/templates` | List all templates for your account |
| `POST` | `/v1/templates` | Create a new template |
| `PATCH` | `/v1/templates/:id` | Update a template |
| `GET` | `/v1/analytics/overview` | Dashboard metrics (AHT, CSAT, brief quality) |
| `GET` | `/v1/analytics/calls` | Per-call breakdown |

All API requests require `Authorization: Bearer YOUR_API_KEY` header.

---

## Voice Configuration

Relay uses **OpenAI's Realtime API** (`gpt-4o-realtime-preview`) for its voice pipeline. This is the same technology behind ChatGPT Voice — it handles speech recognition, conversation, and speech synthesis in a single low-latency stream.

### Available Voices

| Voice | Character | Best For |
|---|---|---|
| `nova` | Warm, friendly, clear | **Default. Recommended for most use cases.** |
| `alloy` | Neutral, professional | Formal or financial contexts |
| `echo` | Calm, measured | Healthcare or sensitive conversations |
| `fable` | Expressive, engaging | Retail, consumer brands |
| `onyx` | Deep, authoritative | B2B, enterprise |
| `shimmer` | Bright, energetic | Consumer tech, e-commerce |

Change the voice per client in the dashboard or via the API:

```bash
curl -X PATCH https://api.relay.ai/v1/clients/YOUR_CLIENT_ID \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{ "voice": "alloy" }'
```

### Tuning Conversation Pace

The two most impactful settings for controlling how Relay sounds in conversation:

```bash
# In your .env or client settings:

RELAY_SILENCE_DURATION_MS=800
# How long Relay waits after the customer stops speaking before responding.
# Lower = faster, more responsive. Higher = more relaxed, less likely to cut off.
# Recommended range: 600ms – 1200ms. Default: 800ms.

RELAY_MAX_RESPONSE_TOKENS=150
# Controls how long each Relay response can be.
# Lower = shorter, punchier responses. Prevents Relay from over-explaining.
# Recommended range: 100 – 200 tokens. Default: 150.
```

---

## Architecture

For the full technical architecture, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

**High-level summary:**

```
  Twilio (telephony)
       │
       ▼
  Relay API Gateway (Node.js)
       │
       ├── OpenAI Realtime API  ←── Voice conversation (STT + LLM + TTS)
       │
       ├── Template Engine      ←── Dynamic prompts per client
       │
       ├── Redis                ←── Session state
       │
       └── Brief Engine         ──► CRM (Salesforce / Zendesk / Webhook)
```

**Key technology choices:**

- **OpenAI Realtime API** for voice — combines STT, LLM, and TTS in one WebSocket connection, reducing end-to-end latency to under 600ms
- **Redis** for session state — fully stateless workers that scale horizontally with active call count
- **Template-driven prompts** — each client's call template is injected into the system prompt at session start, making Relay's questions and field collection fully configurable without code changes

---

## Security & Compliance

- All traffic encrypted in transit (TLS 1.3) and at rest (AES-256)
- Raw audio is never stored — streaming only
- Transcripts retained for 30 days then purged
- PCI-DSS compliant — credit card numbers masked in real-time before storage
- GDPR and PIPEDA compliant — data deletion API with 30-day SLA
- SOC 2 Type II certification in progress (target Q3 2025)
- Twilio webhook signatures validated on every request

---

## Roadmap

| Timeline | What's Coming |
|---|---|
| Q1 2025 | Core voice agent + handoff brief (available now in beta) |
| Q2 2025 | Salesforce and Zendesk integrations GA |
| Q3 2025 | Sentiment analysis + escalation detection |
| Q3 2025 | SOC 2 Type II certification |
| Q4 2025 | Multi-language: Spanish and French |
| 2026 | Healthcare vertical (HIPAA-compliant tier) |
| 2026 | On-premise / private cloud deployment option |

---

## Contributing

Relay is currently in private beta. If you're interested in becoming a design partner or contributing to the project, reach out at **hello@relay.ai**.

---

## License

Copyright © 2025 Relay AI Inc. All rights reserved.

*For enterprise licensing and white-label inquiries, contact sales@relay.ai.*
