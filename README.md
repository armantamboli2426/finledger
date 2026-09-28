# FINLEDGER

FINLEDGER is a local-first bookkeeping MVP for turning bank statement rows into
reviewable transactions, learning confirmed vendor categories, and exporting a
ledger-ready CSV. The project contains a FastAPI API and a Next.js interface.

## Run locally

Requirements: Python 3.10+, Node.js 20.9+, and npm.

```sh
cp .env.example .env
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
# Paste these outputs into AUTH_SECRET, UPLOAD_ENCRYPTION_KEY, and POSTGRES_PASSWORD.
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --env-file .env
```

In a second terminal:

```sh
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The API and interactive docs are available at
http://localhost:8000 and http://localhost:8000/docs.
Create an owner account in the app (email, password, and an international-format
phone number) to initialize a private business workspace.
Keep `AUTH_ALLOW_SIGNUP=true` only during onboarding; disable it afterward.

Generate and store secrets only in the backend environment; never commit or
share the resulting `.env`.

## Try the learning-loop demo

Sign in to the owner workspace created during onboarding and use that same
workspace for both statements:

1. Upload [September synthetic statement](./demo/shree-krishna-september.csv).
2. In transactions, confirm Rahul Traders as `Packaging Material`.
3. Upload [October synthetic statement](./demo/shree-krishna-october.csv).
4. Check the new Rahul Traders row for recalled memory, dashboard totals, and
   export the October statement CSV.

The included CSVs are invented test data, not real customer bank statements.
The authenticated upload page uses the active member workspace. In the
development-open profile, the upload page lets you choose a demo business ID.
`NEXT_PUBLIC_BUSINESS_ID` is only the initial development workspace.

## Run with Docker Compose

Copy `.env.example` to `.env`, set unique auth, encryption, and PostgreSQL secrets, then run `docker compose up --build`. The
frontend is at http://localhost:3000 and the API at http://localhost:8000.
Compose starts PostgreSQL with a healthcheck, waits for database readiness, and
runs Alembic migrations before starting the backend. Direct local API
development continues to use SQLite by default. Configure WhatsApp credentials
only in the root/backend `.env`; they are not passed to the frontend.

## Learning and Hindsight

The default `.env.example` sets `DEMO_MODE=true`; this enables a clearly
identified SQLite-backed demo memory adapter when Hindsight is not configured.
Confirmed demo rules survive backend restarts and are removed only when the
local database is deleted. This is not an external Hindsight service.

To use the official Hindsight Python client, set `HINDSIGHT_URL` to a running
Hindsight API and optionally set `HINDSIGHT_API_KEY`. Set `DEMO_MODE=false` to
disable local-memory fallback. FINLEDGER creates an isolated Hindsight bank for
each business ID and uses recall before categorization and retain after
confirmation. An unavailable or unconfigured memory service is surfaced rather
than presented as a successful recall.

WhatsApp Cloud API integration requires server-side `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, and
a public HTTPS `WHATSAPP_WEBHOOK_URL`. Set `WHATSAPP_BUSINESS_ID` to the active
workspace ID shown in the authenticated Upload screen. Configure the callback
as `https://<your-public-host>/webhooks/whatsapp` in Meta and subscribe the
WhatsApp business account to message events. The integrations status endpoint
reports readiness without returning credential values. The backend implements
webhook verification/signature checks, media processing, and a post-processing
summary reply attempt; live processing was not verified against Meta credentials
in this workspace, and an attempt is not reported as delivered absent provider
confirmation.

For inbound WhatsApp statement documents, FINLEDGER creates a categorized PDF
grouped by suggested category, including debit/credit amounts, confidence,
review flags, and a statement summary, then sends that PDF back to the sender
through the WhatsApp Cloud API. Provider acceptance is recorded separately
from delivery/read callbacks. The same categorized PDF can be downloaded from
each statement detail page. It is a review report, **not a Tally import file**.

## Authentication and tenant isolation

Email/password registration creates an owner and a private business workspace.
Passwords use PBKDF2-HMAC-SHA256; the browser receives a signed, HTTP-only,
SameSite=Strict cookie backed by a revocable server-side session. Each
authenticated business request is checked against account membership. Set
`AUTH_REQUIRED=true`, a unique `AUTH_SECRET` (at least 32 random characters),
and a valid `UPLOAD_ENCRYPTION_KEY` before deployment. Production mode refuses
to start without them and requires HTTPS origins in `CORS_ORIGINS`. Disable
public signup (`AUTH_ALLOW_SIGNUP=false`) after creating the first owner.
Never put credentials in chat or frontend environment variables.

Invitation, password reset, MFA, and identity-provider SSO are not implemented.
Use HTTPS, a secret manager, backups, and deployment-level rate limiting for
internet-facing use.

## OpenAI-compatible categorization

Set `LLM_PROVIDER=groq`, `LLM_API_KEY`, and optionally `LLM_MODEL` and
`LLM_BASE_URL` in the backend environment. The default endpoint is Groq's
OpenAI-compatible chat-completions API with `llama-3.1-8b-instant`. Confirmed business memory takes
precedence; deterministic high-confidence rules remain local; only
low-confidence rows are sent to the configured LLM for a constrained taxonomy
suggestion. Transaction description, vendor, amount, and currency are sent to
the selected provider on that path. The key stays server-side. On provider
failure, deterministic output is retained with a warning and the statement is
marked for review. Settings reports configuration, not provider connectivity.
The authenticated Settings page links to the
[Groq API keys console](https://console.groq.com/keys), accepts the key
without sending it anywhere except the FINLEDGER backend, stores it encrypted
per business, and provides an API-key test. For Hindsight, it links to the
[Hindsight documentation](https://docs.hindsight.vectorize.io/) and accepts the
deployed API endpoint and optional API key; its test creates/verifies that
business's isolated memory bank. Keys are never returned to the browser after
save. Keep `UPLOAD_ENCRYPTION_KEY` stable and backed up to decrypt saved
integration settings after restarts/restores.

## Supported uploads and current limits

- Text PDFs (using `pypdf`), UTF-8 TXT, and CSV statements.
- Transaction rows with common date, description, and amount fields.
- Business-scoped persistent statements and transactions (SQLite locally;
  PostgreSQL in Compose).
- Email/password authentication, revocable sessions, and business-membership
  authorization.
- A database-backed statement queue with restart recovery and retries. Queued
  upload bytes are encrypted with `UPLOAD_ENCRYPTION_KEY` and removed after
  processing.
- Deterministic dashboard totals and per-statement CSV/JSON downloads.
- Persisted statement status and retry metadata.

Scanned-PDF OCR is used when its optional Python and system dependencies are
available. The durable queue is database-backed and polled by the API; it is
not a separate broker service. Use PostgreSQL for production multi-process
workers.
Unparseable statements return an explicit error; FINLEDGER does not invent
transaction rows.

## Tests

```sh
python3 -m pytest -q
cd frontend && npm run lint && npm run build
```

See [backend/README.md](./backend/README.md) and
[frontend/README.md](./frontend/README.md) for API and UI details.
