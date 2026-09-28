# FINLEDGER system architecture

## Runtime components

```text
Browser (Next.js / TypeScript)
        │ same-origin-aware API requests, multipart statement upload
        ▼
FastAPI ── request validation, tenant/business scope, authorization boundary
   ├── Statement service ── PDF/text/CSV extraction, OCR fallback, normalization
   ├── Accounting service ── vendor resolution, category policy, confidence, totals
   ├── Memory service ── Hindsight recall before suggestions; retain after approval
   ├── Persistence ── businesses, statements, transactions, jobs, audit events
   └── WhatsApp adapter ── verify, receive, process, summarize, send
        │
        ├── PostgreSQL (SQLite is suitable for local development only)
        ├── Hindsight API (one logical bank per business)
        ├── Optional OCR engine (only for pages with insufficient extracted text)
        └── Meta WhatsApp Cloud API (external credentials and webhook setup required)
```

The API owns the ledger and deterministic financial calculations. The browser
never receives Hindsight, database, LLM, or WhatsApp access tokens. Document
processing is a backend job: upload returns a statement identifier, and the UI
polls the statement status before presenting the processed data.

The statement queue is persisted in the configured database. Upload bytes are
encrypted using `UPLOAD_ENCRYPTION_KEY`, retained until processing completes,
and removed afterward. A worker claims jobs atomically, retries transient
failures, and requeues interrupted jobs after restart. This is a database
queue, not a separate broker; production multi-process workers should use
PostgreSQL.

## Statement processing and learning flow

1. Validate upload size, extension, content signature, and statement ownership.
2. Persist a statement and processing job, then return its identifier.
3. Extract selectable PDF text first; OCR only pages that need it.
4. Parse supported bank rows, normalize date, vendor, amount, direction,
   currency, balance, and reference, and reject invalid rows. Do not synthesize
   rows when parsing fails.
5. For each normalized vendor, recall business memory before applying local
   deterministic rules; optionally request an LLM suggestion only for
   low-confidence transactions when configured.
6. Calculate confidence and review requirements on the backend.
7. Return suggestions and factual memory-use evidence to the UI.
8. On confirmation/reclassification, persist the accounting decision and retain
   a reusable vendor rule in that business's Hindsight bank.
9. Reuse the same statement processor, category service, and memory bank for
   later uploads, including WhatsApp-originated documents.

Hindsight is qualitative memory, not the accounting database and not an
arithmetic engine. Database transactions own statements, jobs, transaction
amounts, review state, and export history. A Hindsight outage is visible and
must not be represented as a successful recall; previously persisted ledger
data remains available.

## Business isolation

Every business-scoped API request is resolved to a business before statements,
transactions, or exports are loaded. The memory service derives a stable,
opaque Hindsight bank identifier from the business ID. Memory from one bank is
never used to classify a different business. Email/password accounts use PBKDF2 hashes and signed, HTTP-only cookies backed
by revocable database sessions. Every business-scoped request verifies an
active membership; a caller-controlled business ID alone does not grant
access. Production startup requires authentication and configured secrets.

## API surface

| Area | Routes |
| --- | --- |
| Health and configuration | `GET /api/health`, `GET /api/integrations` |
| Authentication | `POST /api/auth/register` (email, password, phone), `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout` |
| Provider setup | `GET/PUT /api/integrations/configuration`, `POST /api/integrations/test` |
| Statements | `POST /api/statements/upload`, `GET /api/statements`, `GET /api/statements/{id}`, `GET /api/statements/{id}/status`, `GET /api/statements/{id}/transactions` |
| Transactions and review | `GET /api/transactions`, `POST /api/transactions/{id}/confirm`, `POST /api/transactions/{id}/reclassify` |
| Dashboard and exports | `GET /api/dashboard`, `GET /api/statements/{id}/export`, `GET /api/exports` |
| Memory | `GET /api/memory`, `GET /api/memory/vendors`, `GET /api/memory/insights` |
| WhatsApp | `GET /webhooks/whatsapp` verification, `POST /webhooks/whatsapp` inbound events |

Financial totals are derived from the same persisted transaction set used by
the statements and exports. Categories are constrained by the backend taxonomy.
CSV output uses explicit debit and credit columns; the product does not claim
compatibility with a vendor-specific Tally import format.

## WhatsApp request lifecycle

```text
Meta webhook
  ├── GET verification challenge (verify token)
  └── POST event
        ├── Verify X-Hub-Signature-256 when an app secret is configured
        ├── Acknowledge and deduplicate provider message IDs
        ├── Resolve the sender/phone-number mapping to a business
        ├── Fetch media using a server-side access token
        ├── Hand the downloaded statement to the shared processor
        ├── Build category-grouped PDF with totals and review flags
        ├── Upload PDF to WhatsApp media API
        └── Send the PDF document to the original sender
```

The webhook must reject invalid signatures when signing is configured, avoid
logging document contents or tokens, and report integration errors truthfully.
Live delivery depends on Meta app credentials, phone-number ID, webhook
subscription, public HTTPS callback URL, and the correct business-to-sender
mapping. An unconfigured deployment only supports local webhook testing.

Workspace owner phone numbers are captured in international format during
registration. A WhatsApp inbound document response is sent to the original
sender number and contains a human-review PDF report; it is not a Tally import
format.

An OpenAI-compatible provider (Groq by default) can classify low-confidence rows. Only the
selected transaction fields are transmitted, and an unavailable provider is
surfaced as a warning while local rules remain the fallback.

## Local and hosted profiles

- Local development uses SQLite and clearly identified demo memory when
  external services are not configured.
- Hosted deployment must set PostgreSQL, unique session and upload encryption
  secrets, allowed HTTPS frontend origins, webhook secrets, and any Hindsight,
  LLM, or Meta Cloud API credentials in a secret manager. Never commit `.env`
  files.
- OCR and LLM providers are optional runtime integrations and must expose their
  status rather than presenting synthetic results when disabled.
