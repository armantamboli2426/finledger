from datetime import date
import hashlib
import hmac
from pathlib import Path
from types import SimpleNamespace
import uuid

import backend.main as backend_main
from backend.database import AuthSessionRow, IntegrationConfigRow, StatementJobRow, WhatsAppReceiptRow, database
from fastapi.testclient import TestClient

from backend.main import (
    MemoryService,
    MemoryUnavailableError,
    app,
    categorize,
    categorize_without_memory,
    memory_service,
    parse_statement_text,
    recover_interrupted_statement_jobs,
    store,
)


client = TestClient(app)


def setup_function() -> None:
    with store.lock:
        store.statements.clear()
        store.transactions.clear()
        store.dismissed_reviews.clear()
    with memory_service._lock:
        memory_service._entries.clear()
    with database.session() as session:
        session.query(StatementJobRow).delete()
        session.query(IntegrationConfigRow).delete()
        session.query(WhatsAppReceiptRow).delete()
        session.commit()


def upload(text: str, business_id: str = "demo-business", filename: str = "statement.txt") -> dict:
    response = client.post(
        "/statements/upload",
        data={"business_id": business_id},
        files={"file": (filename, text.encode(), "text/plain")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_parser_reads_statement_transaction_lines() -> None:
    rows = parse_statement_text(
        "2025-01-10 STARBUCKS COFFEE -12.50\n"
        "2025-01-11 CLIENT PAYMENT 1,250.00\n"
    )
    assert rows == [
        {"date": date(2025, 1, 10), "description": "STARBUCKS COFFEE", "amount": -12.5},
        {"date": date(2025, 1, 11), "description": "CLIENT PAYMENT", "amount": 1250.0},
    ]


def test_text_parser_extracts_transaction_amount_and_running_balance() -> None:
    rows = parse_statement_text("2025-01-10 OFFICE DEPOT -12.50 1,234.50")
    assert rows == [
        {"date": date(2025, 1, 10), "description": "OFFICE DEPOT", "amount": -12.5, "balance": 1234.5}
    ]


def test_csv_parser_supports_debit_and_credit_columns() -> None:
    rows = parse_statement_text(
        "Date,Description,Debit,Credit\n"
        "01/15/2025,Office Depot,25.00,\n"
        "01/16/2025,Client,,100.00\n"
    )
    assert [row["amount"] for row in rows] == [-25.0, 100.0]


def test_csv_parser_preserves_accounting_fields_and_skips_ambiguous_rows() -> None:
    from backend.main import parse_csv_statement

    rows = parse_csv_statement(
        "Date,Description,Debit,Credit,Balance,Reference,Currency\n"
        "01/15/2025,Office Depot,25.00,,100.00,REF-1,INR\n"
        "01/16/2025,Conflicting row,10.00,20.00,110.00,REF-2,INR\n"
    )
    assert len(rows) == 1
    assert rows[0]["amount"] == -25.0
    assert rows[0]["balance"] == 100.0
    assert rows[0]["reference"] == "REF-1"
    assert rows[0]["currency"] == "INR"


def test_categorization_confidence_is_deterministic() -> None:
    assert categorize("UBER TRIP") == ("Travel", 0.94)
    assert categorize("unknown vendor 123") == ("Uncategorized", 0.35)


def test_unparseable_statement_returns_error_without_inventing_rows() -> None:
    response = client.post(
        "/statements/upload",
        data={"business_id": "demo-business"},
        files={"file": ("statement.txt", b"This statement contains no transaction rows", "text/plain")},
    )
    assert response.status_code == 422
    assert "No transactions could be extracted" in response.json()["detail"]


def test_rahul_traders_learning_loop_uses_confirmed_business_memory() -> None:
    first = upload("2025-09-10 Rahul Traders -7800.00")
    transaction = first["transactions"][0]
    assert transaction["category"] == "Packaging Material"
    assert transaction["confidence"] == 0.54
    assert transaction["memory_used"] is False

    confirmed = client.post(
        f"/api/memory/reviews/{transaction['id']}/confirm",
        json={"category": "Packaging Material"},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["category"] == "Packaging Material"

    second = upload("2025-10-10 Rahul Traders -9200.00")
    recalled = second["transactions"][0]
    assert recalled["category"] == "Packaging Material"
    assert recalled["confidence"] == 0.93
    assert recalled["memory_used"] is True
    assert "Previous business memory found" in recalled["memory_summary"]


def test_sweet_shop_demo_csv_taxonomy_is_business_independent_and_keeps_accounting_fields() -> None:
    demo_csv = Path(__file__).resolve().parents[2] / "demo" / "shree-krishna-september.csv"
    response = client.post(
        "/api/statements/upload",
        data={"business_id": "shree-krishna-sweets"},
        files={
            "file": (
                demo_csv.name,
                demo_csv.read_bytes(),
                "text/csv",
            )
        },
    )
    assert response.status_code == 202
    statement_id = response.json()["statement"]["id"]
    transactions = client.get(
        f"/api/statements/{statement_id}/transactions",
        params={"business_id": "shree-krishna-sweets"},
    ).json()
    assert len(transactions) == 10
    by_vendor = {transaction["vendor"]: transaction for transaction in transactions}
    assert by_vendor["Rahul Traders"]["category"] == "Packaging Material"
    assert by_vendor["Rahul Traders"]["confidence"] == 0.54
    assert by_vendor["Rahul Traders"]["amount"] == -7800.0
    assert by_vendor["Amul Distributor"]["category"] == "Raw Material-Dairy"
    assert by_vendor["Local Dairy Supplier"]["category"] == "Raw Material-Dairy"
    assert by_vendor["Shree Packaging"]["category"] == "Packaging Material"
    assert by_vendor["Mahalaxmi Gas"]["category"] == "Gas & Fuel"
    assert by_vendor["Electricity Board"]["category"] == "Electricity"
    assert by_vendor["UPI POS Sales Settlement"]["category"] == "Sales Income"
    first_settlement = next(
        transaction
        for transaction in transactions
        if transaction["reference"] == "SETTLE-SEP-001"
    )
    assert first_settlement["amount"] == 185000.0
    assert first_settlement["balance"] == 685000.0
    taxonomy = client.get("/api/taxonomy").json()["categories"]
    assert {"name": "Raw Material-Dairy", "type": "expense"} in taxonomy
    assert {"name": "Sales Income", "type": "income"} in taxonomy


def test_confirmation_retains_category_for_future_uploads() -> None:
    first = upload("2025-01-10 ACME CLOUD HOSTING -12.50")
    tx = first["transactions"][0]
    response = client.post(
        f"/api/transactions/{tx['id']}/reclassify",
        json={"category": "Hosting"},
    )
    assert response.status_code == 200
    assert response.json()["category"] == "Hosting"
    assert response.json()["final_category"] == "Hosting"
    assert response.json()["confirmed"] is True
    next_upload = upload("2025-01-12 ACME CLOUD HOSTING -20.00")
    assert next_upload["transactions"][0]["category"] == "Hosting"
    assert next_upload["transactions"][0]["confidence"] == 0.93
    assert next_upload["transactions"][0]["memory_used"] is True
    assert client.get("/memory/vendors").json()["count"] == 1


def test_memory_and_statement_data_are_isolated_by_business() -> None:
    assert MemoryService.bank_id("business-a") != MemoryService.bank_id("business-b")
    memory_service.retain("business-a", "Acme", "Software", "test")
    assert memory_service.recall("business-a", "Acme").category == "Software"
    assert memory_service.recall("business-b", "Acme").found is False

    uploaded = upload("2025-01-10 ACME HOSTING -10.00", business_id="business-a")
    statement_id = uploaded["statement"]["id"]
    assert client.get(f"/statements/{statement_id}", params={"business_id": "business-b"}).status_code == 404
    assert client.get("/memory", params={"business_id": "business-b"}).json()["entries"] == []


def test_hindsight_adapter_retains_and_recalls_through_isolated_banks() -> None:
    class HindsightStub:
        def __init__(self) -> None:
            self.banks: list[str] = []
            self.memories: dict[str, list[str]] = {}

        def create_bank(self, bank_id: str, **_: object) -> None:
            self.banks.append(bank_id)

        def retain(self, bank_id: str, content: str, **_: object) -> None:
            self.memories.setdefault(bank_id, []).append(content)

        def recall(self, bank_id: str, **_: object) -> SimpleNamespace:
            result = [SimpleNamespace(text=text) for text in self.memories.get(bank_id, [])]
            return SimpleNamespace(results=result)

        def list_memories(self, bank_id: str, **_: object) -> SimpleNamespace:
            result = [SimpleNamespace(text=text) for text in self.memories.get(bank_id, [])]
            return SimpleNamespace(items=result)

    service = MemoryService()
    service._hindsight_url = "http://hindsight.test"
    service._client = HindsightStub()
    service.retain("business-a", "Rahul Traders", "Packaging Material", "test")

    recalled = service.recall("business-a", "Rahul Traders")
    assert recalled.found is True
    assert recalled.category == "Packaging Material"
    assert service.recall("business-b", "Rahul Traders").found is False
    assert service.list_for_business("business-a")[0].vendor == "rahul traders"


def test_memory_service_failure_is_not_reported_as_a_recall() -> None:
    class BrokenHindsight:
        def create_bank(self, **_: object) -> None:
            return None

        def recall(self, **_: object) -> None:
            raise ConnectionError("offline")

    service = MemoryService()
    service._hindsight_url = "http://hindsight.test"
    service._client = BrokenHindsight()
    try:
        service.recall("business-a", "Acme")
    except MemoryUnavailableError:
        pass
    else:
        raise AssertionError("Unavailable Hindsight must not appear as a successful recall")


def test_confirmation_surfaces_memory_failure_without_mutating_transaction(monkeypatch) -> None:
    uploaded = upload("2025-02-10 New Vendor -15.00")
    transaction = uploaded["transactions"][0]

    def unavailable(*_: object, **__: object) -> None:
        raise MemoryUnavailableError("Hindsight could not retain this decision")

    monkeypatch.setattr(memory_service, "retain", unavailable)
    response = client.post(
        f"/transactions/{transaction['id']}/reclassify",
        json={"category": "Office Supplies", "business_id": "demo-business"},
    )
    assert response.status_code == 503
    unchanged = client.get(f"/api/statements/{transaction['statement_id']}/transactions").json()[0]
    assert unchanged["confirmed"] is False
    assert unchanged["category"] == "Uncategorized"


def test_confirmation_reports_partial_failure_if_database_update_fails(monkeypatch) -> None:
    uploaded = upload("2025-02-10 New Vendor -15.00")
    transaction = uploaded["transactions"][0]

    def database_failure(*_: object, **__: object) -> None:
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(store, "update_transaction", database_failure)
    response = client.post(
        f"/api/transactions/{transaction['id']}/confirm",
        json={"category": "Office Supplies"},
    )
    assert response.status_code == 503
    assert response.json()["detail"]["partial_failure"] is True
    assert response.json()["detail"]["memory_retained"] is True
    unchanged = client.get(
        f"/api/statements/{transaction['statement_id']}/transactions"
    ).json()[0]
    assert unchanged["category"] == "Uncategorized"
    assert unchanged["confirmed"] is False


def test_interrupted_statement_job_status_is_persisted_as_failed() -> None:
    statement = store.all_statements("startup-recovery")
    assert statement == []
    from backend.main import create_queued_statement

    queued = create_queued_statement("startup-recovery", "statement.txt")
    assert queued.status == "queued"
    assert recover_interrupted_statement_jobs() >= 1
    status = client.get(
        f"/api/statements/{queued.id}/status", params={"business_id": "startup-recovery"}
    ).json()
    assert status["status"] == "failed"
    assert "interrupted" in status["warnings"][0]


def test_dashboard_aggregates_income_and_expenses() -> None:
    upload("2025-01-10 STARBUCKS COFFEE -10.00\n2025-01-11 CLIENT PAYMENT 100.00")
    dashboard = client.get("/dashboard").json()
    assert dashboard["transaction_count"] == 2
    assert dashboard["income"] == 100.0
    assert dashboard["expenses"] == 10.0
    assert dashboard["net"] == 90.0
    assert dashboard["expenses_by_category"] == {"Meals": 10.0}
    assert dashboard["metrics"]["net_cash_flow"] == 90.0


def test_csv_and_json_exports_have_expected_content_types() -> None:
    statement_id = upload("2025-01-10 OFFICE DEPOT -25.00")["statement"]["id"]
    csv_response = client.get(f"/statements/{statement_id}/export")
    assert csv_response.status_code == 200
    assert "text/csv" in csv_response.headers["content-type"]
    assert "OFFICE DEPOT" in csv_response.text
    assert "debit,credit,category,subcategory,reference,balance" in csv_response.text.splitlines()[0]
    assert ",25.00,," in csv_response.text.splitlines()[1]
    json_response = client.get(f"/statements/{statement_id}/export?format=json")
    assert json_response.status_code == 200
    assert json_response.json()["statement"]["id"] == statement_id
    pdf_response = client.get(f"/statements/{statement_id}/export?format=pdf")
    assert pdf_response.status_code == 200
    assert pdf_response.headers["content-type"].startswith("application/pdf")
    assert pdf_response.content.startswith(b"%PDF-")
    from pypdf import PdfReader
    from io import BytesIO
    assert "OFFICE DEPOT" in PdfReader(BytesIO(pdf_response.content)).pages[0].extract_text()


def test_whatsapp_webhook_retains_vendor_preference_in_business_scope() -> None:
    response = client.post(
        "/webhooks/whatsapp",
        json={"business_id": "business-wa", "from_number": "+15550000000", "text": "categorize Acme AI: Research"},
    )
    assert response.json()["status"] == "retained"
    assert memory_service.recall("business-wa", "Acme AI").category == "Research"
    assert not memory_service.recall("another-business", "Acme AI").found


def test_whatsapp_document_runs_shared_processor_and_replies_with_summary(monkeypatch) -> None:
    monkeypatch.setenv("WHATSAPP_BUSINESS_ID", "business-doc-reply")
    monkeypatch.setenv("WHATSAPP_ACCESS_TOKEN", "test-access-token")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "test-phone-id")
    monkeypatch.delenv("WHATSAPP_APP_SECRET", raising=False)
    monkeypatch.setattr(
        backend_main,
        "graph_media_download",
        lambda *_: (
            "statement.csv",
            "text/csv",
            b"Date,Description,Debit,Credit,Balance,Reference\n"
            b"2025-01-10,OFFICE DEPOT,25.00,,100.00,REF-1\n"
            b"2025-01-11,POS Sales Settlement,,100.00,200.00,REF-2\n",
        ),
    )
    calls = []

    class FakeResponse:
        def __init__(self, url: str) -> None:
            self.url = url

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            if self.url.endswith("/media"):
                return {"id": "media-outbound-1"}
            return {"messages": [{"id": "wamid.outbound-1"}]}

    class FakeClient:
        def __init__(self, **_: object) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def post(self, url: str, **kwargs: object) -> FakeResponse:
            calls.append((url, kwargs))
            return FakeResponse(url)

    monkeypatch.setattr(backend_main.httpx, "Client", FakeClient)
    payload = {
        "object": "whatsapp_business_account",
        "entry": [{
            "changes": [{
                "value": {
                    "messages": [{
                        "id": "wamid.inbound-doc-1",
                        "from": "15551234567",
                        "type": "document",
                        "document": {
                            "id": "media-1",
                            "filename": "statement.csv",
                            "mime_type": "text/csv",
                        },
                    }]
                }
            }]
        }],
    }
    response = client.post("/webhooks/whatsapp", json=payload)
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "processing"
    receipt = client.get(
        "/api/whatsapp/receipts/wamid.inbound-doc-1",
        params={"business_id": "business-doc-reply"},
    )
    assert receipt.status_code == 200
    assert receipt.json()["status"] == "processed"
    assert receipt.json()["reply_status"] == "accepted_by_graph_api"
    assert receipt.json()["reply_message_id"] == "wamid.outbound-1"
    assert len(calls) == 2
    media_url, media_kwargs = calls[0]
    assert media_url.endswith("/test-phone-id/media")
    assert media_kwargs["data"]["type"] == "application/pdf"
    assert media_kwargs["files"]["file"][1].startswith(b"%PDF-")
    url, kwargs = calls[1]
    assert url.endswith("/test-phone-id/messages")
    assert kwargs["headers"]["Authorization"] == "Bearer test-access-token"
    assert kwargs["json"]["to"] == "15551234567"
    assert kwargs["json"]["type"] == "document"
    assert kwargs["json"]["document"]["id"] == "media-outbound-1"
    summary = kwargs["json"]["document"]["caption"]
    assert "Money in INR 100.00" in summary
    assert "Money out INR 25.00" in summary
    assert "Raw Material" not in summary

    delivery_update = {
        "entry": [{
            "changes": [{
                "value": {
                    "statuses": [{"id": "wamid.outbound-1", "status": "delivered"}]
                }
            }]
        }],
    }
    assert client.post("/webhooks/whatsapp", json=delivery_update).status_code == 200
    delivered = client.get(
        "/api/whatsapp/receipts/wamid.inbound-doc-1",
        params={"business_id": "business-doc-reply"},
    ).json()
    assert delivered["status"] == "delivery_delivered"
    assert delivered["reply_status"] == "delivered"

    duplicate = client.post("/webhooks/whatsapp", json=payload)
    assert duplicate.status_code == 200
    assert duplicate.json()["results"][0]["status"] == "duplicate"
    assert len(calls) == 2


def test_whatsapp_document_graph_failure_is_logged_without_delivery_claim(
    monkeypatch, caplog
) -> None:
    monkeypatch.setenv("WHATSAPP_BUSINESS_ID", "business-reply-failure")
    monkeypatch.setenv("WHATSAPP_ACCESS_TOKEN", "do-not-log-this-token")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "phone-failure")
    monkeypatch.delenv("WHATSAPP_APP_SECRET", raising=False)
    monkeypatch.setattr(
        backend_main,
        "graph_media_download",
        lambda *_: ("statement.txt", "text/plain", b"2025-01-10 OFFICE DEPOT -25.00"),
    )

    class FailingClient:
        def __init__(self, **_: object) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def post(self, *_: object, **__: object):
            raise backend_main.httpx.ConnectError("private provider response detail")

    monkeypatch.setattr(backend_main.httpx, "Client", FailingClient)
    payload = {
        "entry": [{
            "changes": [{
                "value": {
                    "messages": [{
                        "id": "wamid.reply-failure",
                        "from": "15551234567",
                        "type": "document",
                        "document": {"id": "media-failure", "filename": "statement.txt"},
                    }]
                }
            }]
        }],
    }
    assert client.post("/webhooks/whatsapp", json=payload).status_code == 200
    receipt = client.get(
        "/api/whatsapp/receipts/wamid.reply-failure",
        params={"business_id": "business-reply-failure"},
    ).json()
    assert receipt["status"] == "processed"
    assert receipt["reply_status"] == "failed"
    assert receipt["reply_message_id"] is None
    assert "private provider response detail" not in caplog.text
    assert "do-not-log-this-token" not in caplog.text


def test_whatsapp_document_without_outbound_config_logs_warning_and_does_not_claim_delivery(
    monkeypatch, caplog
) -> None:
    monkeypatch.setenv("WHATSAPP_BUSINESS_ID", "business-no-reply")
    for variable in ("WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET"):
        monkeypatch.delenv(variable, raising=False)
    monkeypatch.setattr(
        backend_main,
        "graph_media_download",
        lambda *_: (
            "statement.txt",
            "text/plain",
            b"2025-01-10 OFFICE DEPOT -25.00",
        ),
    )

    class NoNetworkClient:
        def __init__(self, **_: object) -> None:
            raise AssertionError("No Graph API request should be made without credentials")

    monkeypatch.setattr(backend_main.httpx, "Client", NoNetworkClient)
    payload = {
        "entry": [{
            "changes": [{
                "value": {
                    "messages": [{
                        "id": "wamid.inbound-no-config",
                        "from": "15551234567",
                        "type": "document",
                        "document": {"id": "media-no-config", "filename": "statement.txt"},
                    }]
                }
            }]
        }],
    }
    response = client.post("/webhooks/whatsapp", json=payload)
    assert response.status_code == 200
    receipt = client.get(
        "/api/whatsapp/receipts/wamid.inbound-no-config",
        params={"business_id": "business-no-reply"},
    ).json()
    assert receipt["status"] == "processed"
    assert receipt["reply_status"] == "not_configured"
    assert receipt["reply_message_id"] is None
    assert "not configured" in caplog.text.lower()


def test_frontend_routes_expose_ledger_collections() -> None:
    upload("2025-01-10 OFFICE DEPOT -25.00")
    assert len(client.get("/api/statements").json()["statements"]) == 1
    assert len(client.get("/api/transactions").json()["transactions"]) == 1
    assert len(client.get("/api/exports").json()["exports"]) == 1


def test_health_endpoint() -> None:
    health = client.get("/health").json()
    assert health["status"] == "ok"
    assert health["service"] == "finledger"


def test_async_upload_returns_job_and_status_endpoint_tracks_completion() -> None:
    response = client.post(
        "/api/statements/upload",
        data={"business_id": "async-business"},
        files={"file": ("statement.txt", b"2025-01-10 OFFICE DEPOT -125.00", "text/plain")},
    )
    assert response.status_code == 202
    queued = response.json()["statement"]
    assert queued["status"] == "queued"
    assert set(queued) >= {"id", "status"}
    assert response.json()["transactions"] == []
    status = client.get(
        f"/api/statements/{queued['id']}/status", params={"business_id": "async-business"}
    ).json()
    assert status["status"] == "completed"
    assert status["transaction_count"] == 1


def test_async_invalid_upload_fails_without_creating_transactions() -> None:
    response = client.post(
        "/api/statements/upload",
        data={"business_id": "invalid-async-business"},
        files={"file": ("statement.txt", b"No transaction rows here", "text/plain")},
    )
    statement = response.json()["statement"]
    status = client.get(
        f"/api/statements/{statement['id']}/status",
        params={"business_id": "invalid-async-business"},
    ).json()
    assert status["status"] == "failed"
    assert status["transaction_count"] == 0
    assert client.get(
        f"/api/statements/{statement['id']}/transactions",
        params={"business_id": "invalid-async-business"},
    ).json() == []


def test_whatsapp_signature_verification_and_challenge(monkeypatch) -> None:
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "app-secret")
    body = b'{"business_id":"business-signed","from_number":"+15550000000","text":"hello"}'
    signature = "sha256=" + hmac.new(b"app-secret", body, hashlib.sha256).hexdigest()
    assert client.post(
        "/webhooks/whatsapp", content=body, headers={"X-Hub-Signature-256": signature}
    ).status_code == 200
    assert client.post("/webhooks/whatsapp", content=body).status_code == 401

    monkeypatch.setenv("WHATSAPP_VERIFY_TOKEN", "verify-me")
    challenge = client.get(
        "/webhooks/whatsapp",
        params={"hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "12345"},
    )
    assert challenge.status_code == 200
    assert challenge.text == "12345"


def test_whatsapp_summary_never_claims_delivery_without_credentials(monkeypatch) -> None:
    monkeypatch.delenv("WHATSAPP_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("WHATSAPP_PHONE_NUMBER_ID", raising=False)
    response = client.post("/api/whatsapp/summary", json={"to": "+15550000000"})
    assert response.status_code == 503
    assert response.json()["delivered"] is False


def test_taxonomy_and_integration_readiness_routes() -> None:
    assert client.get("/api/taxonomy").json()["confidence_threshold"] == 0.6
    integrations = client.get("/api/integrations").json()
    assert {item["name"] for item in integrations["integrations"]} >= {
        "Hindsight memory", "WhatsApp Cloud API", "Database", "Authentication", "Statement job queue"
    }
    assert client.get("/api/health").status_code == 200


def test_integrations_reports_safe_configuration_readiness(monkeypatch) -> None:
    monkeypatch.setenv("HINDSIGHT_URL", "https://memory.internal")
    monkeypatch.setenv("HINDSIGHT_API_KEY", "secret-memory-key")
    monkeypatch.setenv("WHATSAPP_ACCESS_TOKEN", "secret-wa-token")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "phone-id")
    monkeypatch.setenv("WHATSAPP_VERIFY_TOKEN", "secret-verify")
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "secret-app")
    monkeypatch.setenv("WHATSAPP_WEBHOOK_URL", "https://ledger.example.com/webhooks/whatsapp")
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_API_KEY", "secret-llm-key")
    response = client.get("/api/integrations")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"integrations"}
    integrations = {item["name"]: item for item in body["integrations"]}
    assert set(integrations) == {
        "Database", "Hindsight memory", "WhatsApp Cloud API", "OCR", "LLM",
        "Authentication", "Statement job queue",
    }
    for entry in body["integrations"]:
        assert set(entry) <= {"name", "configured", "mode", "description"}
        assert isinstance(entry["name"], str)
        assert isinstance(entry["configured"], bool)
        assert isinstance(entry["description"], str)
        assert "checks" not in entry
    assert "secret-wa-token" not in response.text
    assert "secret-memory-key" not in response.text
    assert "secret-app" not in response.text
    assert "secret-llm-key" not in response.text
    assert "secret-verify" not in response.text
    assert "memory.internal" not in response.text
    llm = integrations["LLM"]
    assert llm["configured"] is True
    assert "low-confidence" in llm["description"]
    assert "OpenAI-compatible" in llm["description"]
    assert categorize_without_memory("unknown business expense", "business-a") == ("Uncategorized", 0.35)


def test_whatsapp_inbound_not_ready_without_public_https_webhook_url(monkeypatch) -> None:
    monkeypatch.setenv("WHATSAPP_VERIFY_TOKEN", "verify")
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "app-secret")
    monkeypatch.delenv("WHATSAPP_WEBHOOK_URL", raising=False)
    body = client.get("/api/integrations").json()
    whatsapp = next(item for item in body["integrations"] if item["name"] == "WhatsApp Cloud API")
    assert whatsapp["configured"] is False
    assert "public HTTPS" in whatsapp["description"]


def test_api_transaction_confirmation_accepts_direct_category_object() -> None:
    tx = upload("2025-01-10 UNKNOWN MERCHANT -12.00")["transactions"][0]
    response = client.post(
        f"/api/transactions/{tx['id']}/confirm",
        json={"category": "Professional Services"},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["category"] == "Professional Services"
    assert result["final_category"] == "Professional Services"


def test_email_auth_creates_revocable_session_and_enforces_business_membership(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("AUTH_SECRET", "a-test-session-secret-that-is-long-enough")
    assert client.get("/api/dashboard", params={"business_id": "not-a-member"}).status_code == 401
    email = f"auth-{uuid.uuid4()}@example.test"
    phone = f"+1415{uuid.uuid4().int % 10**7:07d}"
    created = client.post("/api/auth/register", json={
        "email": email,
        "password": "a-strong-test-password",
        "phone": phone,
        "business_name": "Secure workspace",
    })
    assert created.status_code == 200, created.text
    assert created.json()["user"]["phone"] == phone
    business_id = created.json()["businesses"][0]["id"]
    assert created.cookies
    assert client.get("/api/dashboard", params={"business_id": business_id}).status_code == 200
    assert client.get("/api/dashboard", params={"business_id": "other-business"}).status_code == 403
    assert client.get(
        "/api/dashboard",
        params={"business_id": "other-business"},
        headers={"X-Business-ID": business_id},
    ).status_code == 403
    statement_upload = client.post(
        "/statements/upload",
        params={"business_id": business_id},
        headers={"X-Business-ID": business_id},
        data={"business_id": business_id},
        files={"file": ("statement.txt", b"2025-01-10 UNKNOWN MERCHANT -12.00", "text/plain")},
    )
    assert statement_upload.status_code == 200, statement_upload.text
    tx = statement_upload.json()["transactions"][0]
    mismatched_category = client.post(
        f"/api/transactions/{tx['id']}/confirm",
        params={"business_id": business_id},
        headers={"X-Business-ID": business_id},
        json={"category": "Office Supplies", "business_id": "other-business"},
    )
    assert mismatched_category.status_code == 403
    assert client.get("/api/auth/session").json()["authenticated"] is True
    client.post("/api/auth/logout")
    login = client.post("/api/auth/login", json={"email": email, "password": "a-strong-test-password"})
    assert login.status_code == 200
    assert login.json()["businesses"][0]["id"] == business_id
    assert client.post("/api/auth/logout").status_code == 200
    with database.session() as session:
        assert session.query(AuthSessionRow).filter_by(user_id=created.json()["user"]["id"]).count() == 0
    assert client.get("/api/auth/session").json()["authenticated"] is False
    assert client.get("/api/dashboard", params={"business_id": business_id}).status_code == 401


def test_durable_queue_encrypts_upload_and_requeues_interrupted_jobs(monkeypatch) -> None:
    from backend.main import enqueue_statement_job

    monkeypatch.setenv("AUTH_SECRET", "local durable queue test secret")
    raw = b"2025-01-10 A VENDOR -42.00"
    statement, job_id = enqueue_statement_job("queue-business", "statement.txt", "text/plain", raw)
    with database.session() as session:
        job = session.get(StatementJobRow, job_id)
        assert job is not None
        assert job.payload != raw
        assert raw not in job.payload
        job.status = "processing"
        statement_row = session.get(backend_main.StatementRow, statement.id)
        assert statement_row is not None
        statement_row.status = "processing"
        session.commit()
    assert recover_interrupted_statement_jobs() >= 1
    with database.session() as session:
        assert session.get(StatementJobRow, job_id).status == "queued"
    backend_main.process_statement_job(job_id)
    assert store.get_statement(statement.id, "queue-business").status == "needs_review"
    with database.session() as session:
        assert session.get(StatementJobRow, job_id).payload == b""


def test_llm_adapter_sends_scoped_transaction_and_validates_taxonomy(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.test/v1/chat/completions")

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"choices": [{"message": {"content": '{"category":"Software","confidence":0.84}'}}]}

    class FakeClient:
        def __init__(self, **_: object) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def post(self, url: str, **kwargs: object) -> FakeResponse:
            assert url == "https://llm.example.test/v1/chat/completions"
            payload = kwargs["json"]
            assert payload["messages"][1]["content"].find("unknown merchant") >= 0
            return FakeResponse()

    monkeypatch.setattr(backend_main.httpx, "Client", FakeClient)
    assert backend_main.categorize_with_llm("unknown merchant", "unknown merchant", -12.5, "INR") == ("Software", 0.84)


def test_llm_adapter_defaults_to_groq_endpoint(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"choices": [{"message": {"content": '{"category":"Utilities","confidence":0.71}'}}]}

    class FakeClient:
        def __init__(self, **_: object) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def post(self, url: str, **kwargs: object) -> FakeResponse:
            assert url == "https://api.groq.com/openai/v1/chat/completions"
            payload = kwargs["json"]
            assert payload["model"] == "llama-3.1-8b-instant"
            return FakeResponse()

    monkeypatch.setattr(backend_main.httpx, "Client", FakeClient)
    assert backend_main.categorize_with_llm("electric bill", "electric bill", -90.0, "INR") == ("Utilities", 0.71)


def test_llm_provider_failure_falls_back_with_review_warning(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_API_KEY", "test-key")

    def unavailable(*_: object) -> tuple[str, float]:
        raise backend_main.httpx.ConnectError("provider offline")

    monkeypatch.setattr(backend_main, "categorize_with_llm", unavailable)
    result = upload("2025-01-10 UNKNOWN MERCHANT -12.00")
    assert result["statement"]["status"] == "needs_review"
    assert "LLM categorization unavailable; deterministic rules were used." in result["statement"]["warnings"]
    assert result["transactions"][0]["category"] == "Uncategorized"


def test_provider_credentials_are_encrypted_and_never_returned(monkeypatch) -> None:
    business_id = f"provider-business-{uuid.uuid4()}"
    hindsight_key = "private-hindsight-test-key"
    llm_key = "private-openai-test-key"
    response = client.put(
        "/api/integrations/configuration",
        params={"business_id": business_id},
        json={
            "hindsight_url": "https://memory.example.test",
            "hindsight_api_key": hindsight_key,
            "llm_provider": "groq",
            "llm_api_key": llm_key,
            "llm_model": "llama-3.1-8b-instant",
        },
    )
    assert response.status_code == 200, response.text
    assert llm_key not in response.text
    assert hindsight_key not in response.text
    assert response.json()["llm"]["has_api_key"] is True
    assert response.json()["llm"]["provider"] == "groq"
    assert response.json()["llm"]["base_url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert response.json()["hindsight"]["has_api_key"] is True
    assert backend_main.provider_settings(business_id, "llm")["api_key"] == llm_key
    with database.session() as session:
        rows = session.query(IntegrationConfigRow).filter_by(business_id=business_id).all()
        assert len(rows) == 2
        assert all(llm_key.encode() not in row.encrypted_config for row in rows)
        assert all(hindsight_key.encode() not in row.encrypted_config for row in rows)
    overview = client.get("/api/integrations", params={"business_id": business_id})
    assert llm_key not in overview.text
    assert hindsight_key not in overview.text
    assert next(item for item in overview.json()["integrations"] if item["name"] == "LLM")["configured"]
    cleared = client.put(
        "/api/integrations/configuration",
        params={"business_id": business_id},
        json={"clear_llm": True, "clear_hindsight": True},
    )
    assert cleared.status_code == 200
    assert cleared.json()["llm"]["has_api_key"] is False
    assert cleared.json()["hindsight"]["has_api_key"] is False
