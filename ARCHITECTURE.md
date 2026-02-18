# Relay — Architecture

> **Version:** 2.0  
> **Last Updated:** February 2025  
> **Status:** Internal Engineering Reference

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Voice Pipeline — OpenAI Realtime API](#3-voice-pipeline--openai-realtime-api)
4. [Template Engine](#4-template-engine)
5. [Session & State Management](#5-session--state-management)
6. [Handoff Brief System](#6-handoff-brief-system)
7. [CRM Integration Layer](#7-crm-integration-layer)
8. [Component Reference](#8-component-reference)
9. [Infrastructure & Deployment](#9-infrastructure--deployment)
10. [Security Architecture](#10-security-architecture)
11. [Latency Budget](#11-latency-budget)
12. [Scaling Strategy](#12-scaling-strategy)

---

## 1. System Overview

Relay is a cloud-native, real-time voice AI platform that replaces hold music with an intelligent conversational agent. When a customer is placed on hold, Relay activates, conducts a structured intake conversation, and delivers a complete handoff brief to the human agent the moment they connect.

### Core Design Principles

| Principle | Implementation |
|---|---|
| **Low latency above all** | OpenAI Realtime API handles STT + LLM + TTS in a single WebSocket stream, targeting < 600ms end-to-end |
| **Stateless services** | All session state lives in Redis. Workers scale horizontally without warm-up |
| **Template-driven conversations** | Each client defines what information they need. Relay's prompts are dynamically generated from templates |
| **Graceful degradation** | If Relay fails mid-call, the customer is silently returned to hold music. The call is never dropped |
| **Speed-controlled speech** | Voice pacing, silence thresholds, and prompt-level instructions prevent rushed or looping conversations |

---

## 2. High-Level Architecture

```
  INBOUND CALL (PSTN / SIP)
         │
         ▼
  ┌──────────────────┐     webhook      ┌─────────────────────────┐
  │   Twilio Voice   │ ───────────────► │   Relay API Gateway      │
  │  (hold trigger)  │                  │   (Node.js / AWS API GW) │
  └──────────────────┘                  └────────────┬────────────┘
                                                     │
                          ┌──────────────────────────┼──────────────────────────┐
                          │                          │                          │
                          ▼                          ▼                          ▼
                ┌─────────────────┐      ┌───────────────────┐      ┌──────────────────┐
                │  Session Mgr    │      │  Voice Pipeline   │      │  Template Engine │
                │  (Redis)        │      │  (OpenAI Realtime │      │  (Postgres +     │
                │                 │      │   WebSocket API)  │      │   Node.js)       │
                └─────────────────┘      └─────────┬─────────┘      └────────┬─────────┘
                                                   │                         │
                                                   │ ◄───── dynamic prompt ──┘
                                                   │
                                                   ▼
                                        ┌──────────────────┐
                                        │  Brief Engine    │
                                        │  (GPT-4o +       │
                                        │   JSON Schema)   │
                                        └────────┬─────────┘
                                                 │
                               ┌─────────────────┴──────────────────┐
                               │                                     │
                               ▼                                     ▼
                  ┌────────────────────────┐          ┌─────────────────────────┐
                  │  Salesforce            │          │  Zendesk /              │
                  │  Service Cloud         │          │  Generic Webhook API    │
                  └────────────────────────┘          └─────────────────────────┘
```

---

## 3. Voice Pipeline — OpenAI Realtime API

The voice pipeline is the heart of Relay. It uses **OpenAI's `gpt-4o-realtime-preview`** model, which handles speech-to-text, LLM reasoning, and text-to-speech in a single persistent WebSocket connection. This eliminates the multi-hop latency of chaining separate STT → LLM → TTS services.

### 3.1 Pipeline Flow

```
  Customer speaks into phone
         │
         ▼
  Twilio Media Stream ──► WebSocket ──► OpenAI Realtime API
  (raw audio, mulaw)                    │
                                        │  Single streaming connection:
                                        │  ┌─────────────────────────┐
                                        │  │  1. STT (Whisper-based) │ < 150ms
                                        │  │  2. GPT-4o reasoning    │ < 250ms
                                        │  │  3. TTS (natural voice) │ < 150ms
                                        │  └─────────────────────────┘
                                        │
                                        ▼
                                  Audio streamed back
                                  to caller via Twilio
                                  
  Total target: < 600ms end-to-end (P95)
```

### 3.2 Voice Configuration

Relay uses OpenAI's **Nova** voice by default — warm, clear, and well-suited for customer service. Clients can switch to Alloy, Echo, Fable, Onyx, or Shimmer via their dashboard.

```javascript
// OpenAI Realtime session configuration
const sessionConfig = {
  model: "gpt-4o-realtime-preview",
  voice: "nova",                          // Warm, natural tone for customer service
  turn_detection: {
    type: "server_vad",
    threshold: 0.5,                       // Sensitivity to customer speech
    prefix_padding_ms: 300,               // Wait 300ms before Relay speaks
    silence_duration_ms: 800,            // Wait 800ms after customer stops — prevents cutting off
  },
  input_audio_transcription: {
    model: "whisper-1"
  },
  instructions: buildSystemPrompt(template, sessionContext),  // Dynamic per client
  max_response_output_tokens: 150,        // Keep responses short and conversational
};
```

### 3.3 Speed & Loop Control

Two of the most common failure modes in voice AI are talking too fast and getting stuck in repetitive loops. Relay addresses both at the prompt and configuration level.

**Speed control — prompt-level instructions injected into every session:**
```
- Speak slowly and clearly at all times.
- Pause naturally between sentences.
- Never rush the customer or overlap their speech.
- If the customer is speaking, always wait until they are completely finished.
- Keep each response to 1-2 sentences maximum.
```

**Loop prevention — structural prompt rules:**
```
- You have a list of required fields below. Work through them in order.
- Once a field is confirmed, NEVER ask for it again under any circumstances.
- If you have collected all required fields, do not ask further questions.
  Instead, confirm the summary and let the customer know an agent is coming.
- If the conversation exceeds 15 turns without completing intake, gracefully
  wrap up with whatever information has been collected.
```

**Turn detection tuning:**
- `silence_duration_ms: 800` — Relay waits 800ms after the customer stops speaking before responding. This prevents cutting people off mid-sentence and creates a natural, unhurried pace.
- `max_response_output_tokens: 150` — Short responses force conciseness and prevent Relay from monologuing.

---

## 4. Template Engine

The Template Engine is what makes Relay configurable per client. Each company defines a **call template** — the set of fields their agents need before a call begins. Relay uses that template to dynamically generate its conversation instructions.

### 4.1 Template Structure

```json
{
  "template_id": "tmpl_telco_billing_v2",
  "client_id": "client_rogers_ca",
  "name": "Billing Inquiry",
  "description": "Used for all inbound billing-related calls",
  "fields": [
    {
      "id": "account_id",
      "label": "Account Number",
      "type": "string",
      "required": true,
      "relay_hint": "Ask naturally: 'Do you have your account number handy, or I can look you up by your phone number'",
      "validation": "^[A-Z]{3}-[0-9]{6}$"
    },
    {
      "id": "issue_type",
      "label": "Issue Type",
      "type": "enum",
      "options": ["unexpected_charge", "payment_failed", "plan_change", "refund_request", "other"],
      "required": true,
      "relay_hint": "Ask: 'Can you tell me a bit about what's going on with your bill today?'"
    },
    {
      "id": "issue_description",
      "label": "Issue Description",
      "type": "text",
      "required": true,
      "relay_hint": "Let the customer explain in their own words. Don't interrupt."
    },
    {
      "id": "steps_tried",
      "label": "Steps Already Tried",
      "type": "array",
      "required": false,
      "relay_hint": "Ask gently: 'Have you had a chance to look into this online, or is this your first time reaching out?'"
    },
    {
      "id": "issue_duration",
      "label": "How Long Has This Been Happening",
      "type": "string",
      "required": false,
      "relay_hint": "Only ask if not already mentioned naturally in conversation."
    }
  ],
  "opening_message": "Hi, I'm Relay — while you wait for an agent, I can take some notes so they're ready to help you the moment they pick up. Would that be okay?",
  "closing_message": "Perfect, I've got everything I need. An agent will be with you shortly — they'll already know what's going on so you won't need to repeat yourself.",
  "tips": [
    {
      "trigger_field": "issue_type",
      "trigger_value": "unexpected_charge",
      "tip": "While you wait, you can also view itemised billing details in the MyAccount app under 'Bill History'."
    }
  ]
}
```

### 4.2 Dynamic Prompt Generation

When a call comes in, the Template Engine fetches the client's active template and injects it into the Realtime API system prompt:

```javascript
function buildSystemPrompt(template, sessionContext) {
  const fieldInstructions = template.fields
    .map((f, i) => `${i + 1}. ${f.label}${f.required ? ' (required)' : ' (optional)'}
       How to ask: ${f.relay_hint}`)
    .join('\n');

  return `
You are Relay, an AI assistant for ${sessionContext.clientName}.
The customer is currently on hold and waiting for a human agent.

YOUR ONLY JOB is to collect the following information through natural conversation,
then confirm the summary with the customer before they are connected.

REQUIRED INFORMATION TO COLLECT:
${fieldInstructions}

RULES — FOLLOW THESE EXACTLY:
- Speak slowly, clearly, and warmly at all times.
- Ask ONE question at a time. Never combine two questions.
- Once a field is confirmed, never ask for it again.
- Do not attempt to solve the customer's problem yourself.
- Do not make any promises about outcomes or resolution times.
- If the customer says they just want to hold, say "Of course, no problem" and stop immediately.
- After all required fields are collected, deliver this closing message exactly:
  "${template.closing_message}"

OPENING MESSAGE (say this exactly when the call begins):
"${template.opening_message}"
  `.trim();
}
```

### 4.3 Real-Time Field Extraction

As the conversation progresses, a parallel extraction process monitors the transcript and updates the session's intake JSON:

```
  Transcript update event
         │
         ▼
  ┌──────────────────────────┐
  │  Field Extractor         │
  │  (GPT-4o, structured     │
  │   output mode)           │
  │                          │
  │  Input:  latest turn     │
  │          current fields  │
  │  Output: updated fields  │
  └──────────┬───────────────┘
             │
             ▼
  Redis session state updated
  (intake JSON patched in place)
```

---

## 5. Session & State Management

All active call state is stored in **Redis (AWS ElastiCache)**. Services are fully stateless — any worker can handle any call.

### 5.1 Session Object

```json
{
  "session_id": "relay_abc123xyz",
  "call_sid": "CA1234567890abcdef",
  "client_id": "client_rogers_ca",
  "template_id": "tmpl_telco_billing_v2",
  "customer": {
    "phone": "+16045550192",
    "account_id": null,
    "name": null
  },
  "intake": {
    "account_id": "ACC-449201",
    "issue_type": "unexpected_charge",
    "issue_description": "There is an $84 charge on my February bill I don't recognise.",
    "steps_tried": ["Checked account online", "Could not find explanation"],
    "issue_duration": null
  },
  "conversation_turns": 7,
  "sentiment": "frustrated",
  "opt_out": false,
  "brief_ready": false,
  "tips_delivered": ["billing_app_tip"],
  "created_at": "2025-02-18T14:20:14Z",
  "updated_at": "2025-02-18T14:22:41Z"
}
```

**TTL:** 2 hours. Sessions older than 2 hours are automatically expired.

---

## 6. Handoff Brief System

When Twilio signals that a human agent has accepted the call, the Brief Engine has approximately 2–3 seconds to generate and deliver the brief before the agent speaks.

### 6.1 Handoff Trigger Flow

```
  Twilio webhook: "call_transferred"
         │
         ▼
  API Gateway receives event
         │
         ▼
  Brief Engine triggered (async, parallel to call connection)
         │
  ┌──────┴──────────────────────────────────────────────────┐
  │  1. Fetch session state from Redis                       │
  │  2. Call GPT-4o with full conversation + intake JSON    │
  │  3. Generate human-readable brief + suggested actions   │
  │  4. Validate against JSON schema                        │
  │  5. Push to CRM Connector                               │
  └──────────────────────────────────────────────────────────┘
         │
         ▼ (< 3 seconds total)
  CRM sidebar updated before agent speaks
```

### 6.2 Brief Output Schema

```json
{
  "session_id": "relay_abc123xyz",
  "generated_at": "2025-02-18T14:22:44Z",
  "customer": {
    "name": "Sarah Chen",
    "account_id": "ACC-449201",
    "phone": "+16045550192"
  },
  "summary": "Customer is calling about an unexpected $84 charge on her February bill. She has checked her account online but cannot identify the source of the charge.",
  "issue_type": "unexpected_charge",
  "steps_tried": [
    "Checked account online",
    "Could not find explanation for charge"
  ],
  "sentiment": "frustrated",
  "sentiment_note": "Customer expressed frustration about not being able to find answers online. Tone is firm but not hostile.",
  "suggested_actions": [
    "Pull February billing statement for ACC-449201",
    "Check for recent plan change or one-time add-on charge",
    "Review promo expiry dates that may have caused price increase"
  ],
  "tips_delivered": [
    "Directed customer to MyAccount app billing history"
  ],
  "fields_collected": 4,
  "fields_required": 4,
  "conversation_duration_sec": 147,
  "relay_confidence": 0.94
}
```

### 6.3 Fallback Behaviour

If the brief cannot be delivered within 3 seconds:

1. A **minimal brief** is delivered immediately (customer phone + account ID from session state)
2. The full brief is queued and pushed to the CRM case record asynchronously within 30 seconds
3. The agent sees a banner: *"Full Relay brief loading..."* which updates automatically

---

## 7. CRM Integration Layer

The CRM Connector is a lightweight microservice that receives the brief JSON and delivers it to the appropriate CRM. It is decoupled from the Brief Engine via a Kafka event.

```
  Brief Engine publishes to Kafka topic: relay.brief.ready
         │
         ▼
  CRM Connector subscribes
         │
         ├──► Salesforce Service Cloud
         │    (REST API, case record + agent console widget)
         │
         ├──► Zendesk
         │    (REST API, ticket + sidebar app)
         │
         └──► Generic Webhook
              (POST to client-configured URL, signed with HMAC-SHA256)
```

**Retry logic:** Exponential backoff, max 3 attempts, 500ms base delay. Failed deliveries are dead-lettered for manual review.

---

## 8. Component Reference

| Component | Technology | Purpose |
|---|---|---|
| Telephony | Twilio Voice | Inbound PSTN, hold queue detection, call routing |
| API Gateway | AWS API Gateway + Node.js | Webhook entry point, auth, rate limiting |
| Voice Pipeline | OpenAI Realtime API (`gpt-4o-realtime-preview`) | Full STT + LLM + TTS in one WebSocket stream |
| Voice | OpenAI Nova (default) | Natural, warm customer service voice |
| Session State | Redis (AWS ElastiCache) | Low-latency stateless session store |
| Template Engine | Node.js + PostgreSQL | Stores client templates, generates dynamic prompts |
| Field Extractor | GPT-4o (structured output) | Real-time JSON extraction from conversation turns |
| Brief Engine | GPT-4o + JSON Schema | Generates handoff brief at call transfer |
| CRM Connector | Node.js microservice | Pushes brief to Salesforce, Zendesk, or webhook |
| Event Bus | Apache Kafka (AWS MSK) | Decouples pipeline stages, enables replay |
| Analytics DB | ClickHouse | High-throughput event ingestion, dashboard queries |
| Manager Dashboard | React + Next.js | CX metrics, brief quality scores, AHT trends |
| Monitoring | Datadog | APM, latency percentiles, alerting |
| Secrets | AWS Secrets Manager | API keys for all external services |
| CI/CD | GitHub Actions | Test, build, blue/green deploy via ECS |

---

## 9. Infrastructure & Deployment

```
  AWS (us-east-1 primary, us-west-2 failover)
  │
  ├── ECS Fargate (auto-scaling containers)
  │   ├── relay-api-gateway
  │   ├── relay-voice-worker (1 per active call)
  │   ├── relay-brief-engine
  │   ├── relay-crm-connector
  │   └── relay-template-service
  │
  ├── ElastiCache (Redis, Multi-AZ)
  │   └── Session state, TTL 2hr
  │
  ├── RDS PostgreSQL (Multi-AZ)
  │   └── Clients, templates, brief archive, billing
  │
  ├── MSK (Kafka)
  │   └── Events: call.started, turn.completed, brief.ready, call.transferred
  │
  ├── ClickHouse (self-hosted on EC2)
  │   └── Analytics, dashboard queries
  │
  └── CloudFront
      └── Dashboard static assets
```

**Scaling trigger:** ECS auto-scales voice workers when CPU > 60% for 2 consecutive minutes. Each worker handles one active call (required by real-time streaming architecture).

---

## 10. Security Architecture

### Data Flow

- All external traffic: TLS 1.3 minimum
- Internal service-to-service: mTLS within VPC
- Twilio webhooks: HMAC-SHA256 signature validation on every request
- CRM webhook delivery: signed with client-specific HMAC-SHA256 key

### Data Retention

| Data Type | Storage Duration | Notes |
|---|---|---|
| Raw audio | Never stored | Streaming only, not persisted |
| Transcripts | 30 days | Encrypted at rest (AES-256) |
| Brief JSON | 12 months | Audit trail + model improvement |
| Customer PII | Per data agreement | Deletion API available, 30-day SLA |

### Compliance

- **PCI-DSS:** Credit card numbers detected and masked in real-time before any transcript storage
- **HIPAA-ready:** PHI fields isolated in encrypted partition with separate access controls (Phase 2)
- **GDPR / PIPEDA:** Data deletion API, data residency controls, consent logging
- **SOC 2 Type II:** Target Q3 2025

---

## 11. Latency Budget

| Pipeline Stage | Target | Notes |
|---|---|---|
| Audio capture + Twilio send | < 50ms | Network dependent |
| OpenAI Realtime (STT + LLM + TTS combined) | < 500ms | Single WebSocket, streamed |
| Audio delivery to caller | < 50ms | Twilio playback |
| **Total end-to-end (P95)** | **< 600ms** | |
| Brief generation (at handoff) | < 3,000ms | Runs in parallel, not in call loop |

> **Note:** The shift from a chained STT → LLM → TTS pipeline to OpenAI Realtime API reduces end-to-end latency from ~800ms to ~600ms by eliminating two network hops.

---

## 12. Scaling Strategy

**Theoretical capacity:** At 10,000 concurrent calls, Relay runs 10,000 ECS Fargate tasks. At ~$0.02/hr per t3.small equivalent, peak cost is ~$200/hr — but real-world average concurrency at 10K calls/day is 400–600 simultaneous sessions across business hours.

**Future architecture considerations:**

- **Edge inference:** Move TTS streaming to CloudFront edge for geographically distributed callers
- **Fine-tuned model:** As brief quality feedback accumulates, fine-tune a smaller, faster model for Relay's specific intake use case
- **Multi-region active-active:** Required before EU expansion (GDPR data residency)
- **On-premise option:** Healthcare and government clients will require self-hosted deployment. Planned for v2 as a containerised package.

---

*For API reference, see `/docs/api`. For deployment runbooks, see `/docs/ops`.*
