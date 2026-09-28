# FINLEDGER backend

FastAPI bookkeeping API with SQLAlchemy persistence, Alembic migrations, deterministic categorization, and optional Hindsight and WhatsApp Cloud API integrations.

## Run locally

Python 3.9 can run the SQLite demo and test suite. Full Hindsight and OCR integrations target Python 3.10+.

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

SQLite is the default (`sqlite:///./finledger.db`). To use PostgreSQL set `DATABASE_URL`, for example `postgresql+psycopg://user:password@localhost:5432/finledger`, then initialize or upgrade the schema:

```sh
alembic upgrade head
```

Docker Compose starts PostgreSQL and runs migrations before starting the API. Set production secrets in `.env` or a secret manager; do not put them in frontend configuration.

## Statement flow

`POST /api/statements/upload` encrypts and persists the upload and job in SQL
before returning `202`. A database-backed worker claims queued jobs, retries
transient failures up to three attempts, and requeues interrupted work after
restart. Upload bytes are encrypted with Fernet using `UPLOAD_ENCRYPTION_KEY`
and deleted after processing. Keep this key stable to process queued work and
restore backups. Use PostgreSQL for multiple API/worker processes; SQLite is
for local development. Poll `GET /api/statements/{id}/status` until a terminal
status. The legacy `POST /statements/upload` route remains synchronous.
Uploads are limited to 15 MB. Scanned PDFs need `pdf2image`, `pytesseract`,
Tesseract, and Poppler.

All statement and transaction reads are scoped by `business_id`. Categories use deterministic keyword rules and fixed confidence values; low-confidence transactions need review. Confirmation retains the memory rule before committing the transaction update. If database persistence fails after a successful external memory retain, the API explicitly reports a partial failure. Configure `HINDSIGHT_URL` and optionally `HINDSIGHT_API_KEY` to use the official Hindsight client for retain, recall, and reflect. Each business has an isolated Hindsight bank. `DEMO_MODE=true` enables a local persistent SQLite/PostgreSQL memory fallback only when Hindsight is not configured; set false to disable that fallback. Health and integration endpoints report the active mode and degradation.

Set `LLM_PROVIDER=groq`, `LLM_API_KEY`, and optionally `LLM_BASE_URL` and
`LLM_MODEL` to enable Groq (or another OpenAI-compatible provider) for
low-confidence rows. The default Groq model is `llama-3.1-8b-instant`.
Confirmed memory is preferred and deterministic high-confidence rules stay
local. The provider receives transaction description, vendor, amount, and
currency. Provider errors are logged without transaction details, recorded as
statement warnings, and fall back to deterministic suggestions. Credentials
are never returned by the readiness endpoint.

Email/password authentication uses PBKDF2-HMAC-SHA256, signed HTTP-only
SameSite=Strict cookies, revocable server-side sessions, and per-business
membership checks. In production set `FINLEDGER_ENV=production`,
`AUTH_REQUIRED=true`, a unique `AUTH_SECRET`, and `UPLOAD_ENCRYPTION_KEY`.
Production startup also requires HTTPS `CORS_ORIGINS`. Create the owner account
then set `AUTH_ALLOW_SIGNUP=false`. Invitation, password recovery, MFA, and SSO
are not part of this release.

The sweet-shop taxonomy applies to any business ID (not just the default workspace): Rahul Traders starts as `Packaging Material` at confidence `0.54`; Amul and local dairy suppliers map to `Raw Material-Dairy`; packaging, gas/fuel, electricity, and POS sales settlements have dedicated categories. CSV imports preserve debit/credit sign, reference, and balance fields.

CSV exports use accounting debit/credit signs: negative transaction amounts are debits and positive amounts are credits. Dashboard totals are all-time aggregates over the selected business.

## WhatsApp Cloud API

Configure `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and the public HTTPS `WHATSAPP_WEBHOOK_URL`. Register `/webhooks/whatsapp` as the Meta callback. GET verification uses the configured verify token. POST webhooks require a valid `X-Hub-Signature-256` HMAC whenever an app secret is configured. Inbound text commands can retain a vendor rule; PDF/TXT/CSV document media and OCR-supported images go through the shared statement processor. When processing completes and outbound credentials are configured, FINLEDGER sends a category-grouped PDF and totals caption back to the WhatsApp sender. Provider message IDs are persisted for deduplication and receipt status at `/api/whatsapp/receipts/{provider_message_id}`; Graph acceptance is distinct from the later `sent`/`delivered`/`read` status callbacks. Missing configuration or send failures are logged safely and never reported as delivered. `POST /api/whatsapp/summary` sends a text-only summary.

For inbound statement documents the configured sender receives a
category-grouped PDF report with totals, debit/credit amounts, confidence and
review status. The same report is available from statement export with
`?format=pdf`. It is a human review report, not a Tally-importable file.

Interactive API documentation: `http://127.0.0.1:8000/docs`.

`GET /api/integrations` reports database connectivity and configuration
readiness for Hindsight, WhatsApp, OCR, LLM, authentication, and the statement
queue. `PUT /api/integrations/configuration` stores per-business Hindsight and
OpenAI-compatible LLM credentials encrypted using the configured upload
encryption key; `POST /api/integrations/test` validates those credentials.
Responses only report whether a key exists and never return a saved secret.
Provider connectivity is tested only when explicitly requested; readiness
alone does not claim WhatsApp delivery.
