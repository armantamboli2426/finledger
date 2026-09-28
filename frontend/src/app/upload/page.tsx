"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiRecord, apiRequest, DEFAULT_BUSINESS_ID, displayValue, getBusinessId, isRecord, persistBusinessId, recordsFrom } from "@/lib/api";
import { Icon } from "@/components/Icons";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ApiRecord | null>(null);
  const [businessId, setBusinessId] = useState(DEFAULT_BUSINESS_ID);
  const [workspaceLocked, setWorkspaceLocked] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setBusinessId(getBusinessId());
    void apiRequest("/api/auth/session").then((session: unknown) => {
      if (isRecord(session) && session.authenticated === true) setWorkspaceLocked(true);
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not verify workspace access.");
    });
  }, []);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    acceptFile(selected);
  }

  function acceptFile(selected: File | null) {
    if (selected && !/\.(pdf|txt|csv)$/i.test(selected.name)) {
      setFile(null);
      setError("Choose a PDF, TXT, or CSV file.");
      return;
    }
    setFile(selected);
    setError("");
    setResult(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Choose a statement file before continuing.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("business_id", businessId.trim());
    persistBusinessId(businessId);
    try {
      const initial: unknown = await apiRequest("/api/statements/upload", { method: "POST", body: formData });
      if (!isRecord(initial)) throw new Error("The API returned an invalid upload response.");
      setResult(initial);
      const statement = isRecord(initial.statement) ? initial.statement : initial;
      const id = typeof statement.id === "string" ? statement.id : typeof initial.statement_id === "string" ? initial.statement_id : "";
      let latest: ApiRecord = initial;
      if (id && ["queued", "pending", "processing", "uploaded"].includes(String(statement.status ?? initial.status).toLowerCase())) {
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          setProcessingStatus("Processing statement…");
          await new Promise((resolve) => setTimeout(resolve, 900));
          const status: unknown = await apiRequest(`/api/statements/${encodeURIComponent(id)}/status`);
          if (!isRecord(status)) throw new Error("The API returned an invalid processing status.");
          latest = status;
          const state = String(status.status ?? "").toLowerCase();
          if (state === "failed" || state === "error") {
            const warnings = Array.isArray(status.warnings) ? status.warnings : [];
            throw new Error(displayValue(status.error ?? status.detail ?? warnings[0], "Statement processing failed."));
          }
          if (!["queued", "pending", "processing", "uploaded"].includes(state)) break;
        }
        if (Date.now() >= deadline) throw new Error("Statement processing is taking longer than expected. Check the statement status page.");
      }
      if (id && ["completed", "needs_review"].includes(String(latest.status ?? (isRecord(initial.statement) ? initial.statement.status : initial.status)).toLowerCase())) {
        const transactions: unknown = await apiRequest(`/api/statements/${encodeURIComponent(id)}/transactions`);
        latest = { ...latest, transactions: recordsFrom(transactions) };
      }
      const updated: ApiRecord = { ...initial, processing: latest };
      if (Array.isArray(latest.transactions)) updated.transactions = latest.transactions;
      if (isRecord(initial.statement)) {
        updated.statement = { ...initial.statement, ...latest };
      } else {
        Object.assign(updated, latest);
      }
      setResult(updated);
      setProcessingStatus("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The file could not be uploaded.");
      setProcessingStatus("");
    } finally {
      setBusy(false);
    }
  }

  return <div className="page-wrap">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> BRING YOUR BOOKS TOGETHER</div><h1>Upload a statement</h1><p>Share a statement and let the ledger take it from here.</p></div></div>
    <div className="upload-layout">
      <form className="panel upload-form" onSubmit={submit}>
        <label className="settings-field upload-business-field"><span>Business memory workspace</span><input value={businessId} onChange={(event) => { setBusinessId(event.target.value); persistBusinessId(event.target.value); }} readOnly={workspaceLocked} required minLength={2} maxLength={120} aria-label="Business memory workspace" /></label>
        <div className={`drop-zone ${file ? "drop-zone-selected" : ""}`} role="button" tabIndex={0} aria-label="Choose or drop a statement file" onClick={(event) => { if (event.target !== input.current) input.current?.click(); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.current?.click(); } }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); acceptFile(event.dataTransfer.files[0] ?? null); }}>
          <input ref={input} type="file" accept=".pdf,.txt,.csv" onChange={chooseFile} hidden aria-label="Choose statement file" />
          <span className="upload-cloud"><Icon name="upload" size={23} /></span>
          <strong>{file ? file.name : "Drop your statement here"}</strong>
          <span>{file ? `${(file.size / (1024 * 1024)).toFixed(2)} MB · Ready to upload` : "or click to browse your files"}</span>
          <small>PDF, TXT or CSV · File is sent to your FINLEDGER API</small>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        {result && <div className="upload-result" role="status"><span className="result-check"><Icon name="check" size={16} /></span><span><strong>{displayValue(result.message ?? (isRecord(result.statement) ? result.statement.status : result.status), "Upload received")}</strong><small>{displayValue(isRecord(result.statement) ? result.statement.filename : result.filename, "Your API response has been received.")}{Array.isArray(result.transactions) ? ` · ${result.transactions.length} transactions` : ""}{isRecord(result.processing) && typeof result.processing.pages_processed === "number" ? ` · ${result.processing.pages_processed} pages` : ""}</small>{isRecord(result.statement) && typeof result.statement.id === "string" && <Link href={`/statements/${encodeURIComponent(result.statement.id)}`}>View statement <Icon name="arrow" size={13} /></Link>}</span></div>}
        <div className="upload-footer"><span><Icon name="shield" size={15} /> {processingStatus || "Your data stays yours"}</span><button className="button button-primary" type="submit" disabled={busy || !file || !businessId.trim()}><Icon name="upload" size={16} /> {busy ? processingStatus || "Uploading…" : "Upload statement"}</button></div>
      </form>
      <aside className="panel upload-aside"><span className="aside-spark"><Icon name="file" size={18} /></span><h2>From statement to clarity.</h2><p>Your file is processed by the connected ledger service. Review its transactions and help the books learn your preferences.</p><div className="process-step"><span>01</span><div><strong>Upload</strong><small>Send a supported statement</small></div></div><div className="process-step"><span>02</span><div><strong>Review</strong><small>Check data returned by the API</small></div></div><div className="process-step"><span>03</span><div><strong>Remember</strong><small>Confirm patterns that fit your books</small></div></div></aside>
    </div>
  </div>;
}
