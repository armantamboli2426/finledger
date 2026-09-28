# FINLEDGER frontend

A responsive Next.js and TypeScript workspace for the FINLEDGER ledger API. Dashboard figures, activity, transaction records, statement data, memory evidence, exports, WhatsApp status, and user preferences are requested from the backend. The interface does not include demo ledger data: it shows a clear empty state when an endpoint returns no records and a retryable error when an endpoint is unavailable.

## Run locally

Requirements: Node.js 20.9+, npm, and (to run the included API) Python 3.10+.

Start the included backend from the workspace root in one terminal. Configure
the root `.env` first; the frontend uses the backend's email/password login
and receives only an HTTP-only session cookie:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

The API docs are at [http://localhost:8000/docs](http://localhost:8000/docs).
Statement data and local memory are stored in the configured database.

```bash
cd frontend
npm install
cp .env.example .env.local
# Set NEXT_PUBLIC_API_URL if your backend is not at http://localhost:8000
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). For a production build, run `npm run build` and then `npm start`.

`NEXT_PUBLIC_API_URL` defaults to `http://localhost:8000`. The backend CORS
configuration must include the frontend origin. Requests include credentials
and the active business ID; the backend verifies the session and business
membership whenever `AUTH_REQUIRED=true`.

## Views

- `/` — dashboard metrics, latest activity, learning-loop review and WhatsApp status.
- `/upload` — multipart statement upload.
- `/statements` and `/statements/[id]` — statement list and detail.
- `/transactions` — transaction list.
- `/memory` — saved patterns and their supporting evidence.
- `/exports` — available export links.
- `/settings` — editable settings returned by the API.

## API contract used by the frontend

All endpoints are relative to `NEXT_PUBLIC_API_URL` and match the included FastAPI backend. The backend scopes data using an optional `business_id` query/form field (default `demo-business`). Collection endpoints may return either an array or an object containing an `items`, `results`, `data`, or resource-named array. The dashboard endpoint returns an object. Errors should use non-2xx HTTP status codes with a readable response body.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/dashboard` | `{ user_name?, metrics?, review?, review_status?, whatsapp?, activity? }`. Metrics may include `net_cash_flow`, `money_in`, `money_out`, `needs_review`, period/caption fields, and `currency`. `review` is a pending suggestion object with an `id` or `review_id`, counterparty/merchant, category/suggestion, evidence, confidence, title, and description. The dashboard displays a Rahul Traders review only when that counterparty is returned by the API. `whatsapp` may include `connected`, `business_name`/`phone_number`, message/document counts, description, and a `link`. |
| `GET` | `/api/statements` | Array or `{ items: [...] }` containing `id`, `filename`, `account_name`, `period`, `uploaded_at`, and `status`. |
| `GET` | `/api/statements/{id}` | Statement fields directly. |
| `GET` | `/api/statements/{id}/transactions` | Transactions belonging to the statement. |
| `POST` | `/api/statements/upload` | Multipart form field `file`; accepts PDF, TXT, or CSV, plus optional `business_id`. Response contains `statement` and `transactions`. |
| `GET` | `/api/transactions` | Array or `{ items: [...] }` containing date, description, category, account, amount, currency, and status fields. |
| `GET` | `/api/memory` | `{ memories: [...] }` of saved memories. Each may include rule, category, status, confidence, last-applied time, and an evidence array. |
| `POST` | `/api/memory/reviews/{id}/confirm` | Confirm the pending dashboard suggestion and remember it. |
| `POST` | `/api/memory/reviews/{id}/dismiss` | Dismiss the pending dashboard suggestion. |
| `GET` | `/api/exports` | Array or `{ items: [...] }` with export name/filename, format, created time, and `url`, `download_url`, or `download_path`. |
| `GET` | `/api/settings` | Optional settings endpoint. The included demo backend does not implement settings, so the settings page shows the API error until a settings service is connected. |
| `PUT` | `/api/settings` | Optional settings endpoint; sends editable settings as a JSON object. |

Confirm/dismiss responses may be empty (`204`) or JSON. Export links are opened by the browser; serve authenticated downloads or use short-lived signed URLs according to the backend's access model.
