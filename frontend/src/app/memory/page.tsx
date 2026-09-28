"use client";

import { useState } from "react";
import { ApiRecord, apiRequest, displayValue, isRecord, recordsFrom } from "@/lib/api";
import { EmptyState, ErrorState, LoadingState, useApi } from "@/components/ApiState";
import { Icon } from "@/components/Icons";

export default function MemoryPage() {
  const { data, error, loading, reload } = useApi<unknown>("/api/memory");
  const items = recordsFrom(data);
  const [insight, setInsight] = useState("");
  const [insightError, setInsightError] = useState("");
  const [insightBusy, setInsightBusy] = useState(false);
  const memoryMode = isRecord(data) ? displayValue(data.memory_mode, "unavailable") : "unavailable";
  const memoryLabel = memoryMode === "hindsight" ? "HINDSIGHT MEMORY ACTIVE" : memoryMode === "demo" ? "LOCAL DEMO MEMORY" : "MEMORY UNAVAILABLE";
  return <div className="page-wrap">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> LEARNING LOOP</div><h1>Memory</h1><p>Transparent, evidence-backed patterns shaped by your decisions.</p></div><span className="memory-badge"><Icon name={memoryMode === "hindsight" ? "check" : "file"} size={15} /> {memoryLabel}</span></div>
    <div className="memory-intro"><div className="memory-intro-icon"><Icon name="shield" size={23} /></div><div><strong>Nothing is remembered without a reason.</strong><p>Each memory links back to evidence from your ledger. Confirm or correct suggestions to help future bookkeeping; you stay in control.</p></div></div>
    {error && <ErrorState message={error} onRetry={reload} />}
    {loading && <LoadingState label="Loading your memory…" />}
    {!loading && !error && items.length === 0 && <div className="panel collection-empty"><EmptyState title="Your memory is just getting started" description="Once the API has saved a confirmed pattern, its rule and supporting evidence will appear here." /></div>}
    {!loading && !error && items.length > 0 && <div className="memory-list">{items.map((item, index) => <MemoryCard key={displayValue(item.id, String(index))} item={item} />)}</div>}
    {!loading && !error && <section className="panel memory-insight-panel">
      <div className="panel-heading"><div className="panel-title-group"><span className="heading-icon learning-icon"><Icon name="file" size={17} /></span><div><h2>Business patterns</h2><p>Reflect on recurring accounting behavior using the connected memory service.</p></div></div>
        <button className="button button-secondary button-small" disabled={insightBusy || memoryMode !== "hindsight"} onClick={async () => {
          setInsightBusy(true);
          setInsightError("");
          try {
            const result: unknown = await apiRequest("/api/memory/insights");
            if (!isRecord(result) || typeof result.insight !== "string") throw new Error("The memory service returned an invalid insight.");
            setInsight(result.insight);
          } catch (reason) {
            setInsightError(reason instanceof Error ? reason.message : "Business insights are unavailable.");
          } finally {
            setInsightBusy(false);
          }
        }}>{insightBusy ? "Reflecting…" : "Generate insight"}</button>
      </div>
      {memoryMode !== "hindsight" && <p className="memory-insight-muted">Insights require a configured Hindsight service. No generated insight is shown in local demo mode.</p>}
      {insightError && <div className="inline-error" role="alert">{insightError}</div>}
      {insight && <p className="memory-insight-text" role="status">{insight}</p>}
    </section>}
  </div>;
}

function MemoryCard({ item }: { item: ApiRecord }) {
  const evidence = Array.isArray(item.evidence) ? item.evidence.filter(isRecord) : [];
  return <article className="panel memory-card">
    <div className="memory-card-top"><span className="memory-rule-icon"><Icon name="file" size={17} /></span><span className="memory-rule-label">BOOKKEEPING MEMORY</span><span className={`status-tag status-${displayValue(item.status, "confirmed").toLowerCase()}`}>{displayValue(item.status, "Confirmed")}</span></div>
    <h2>{displayValue(item.title ?? item.counterparty, "Ledger pattern")}</h2>
    <p className="memory-rule">{displayValue(item.rule ?? item.description, "A saved pattern from your ledger.")}</p>
    <div className="memory-meta"><span>Category <strong>{displayValue(item.category)}</strong></span><span>Last applied <strong>{displayValue(item.last_applied_at)}</strong></span><span>Confidence <strong>{typeof item.confidence === "number" ? `${Math.round(item.confidence * 100)}%` : displayValue(item.confidence)}</strong></span></div>
    <div className="evidence-area"><h3><Icon name="shield" size={15} /> Supporting evidence <span>{displayValue(evidence.length || item.evidence_count, "0")}</span></h3>
      {evidence.length > 0
        ? <div className="evidence-list">{evidence.map((entry, index) => <div className="evidence-row" key={displayValue(entry.id, String(index))}><span className="evidence-dot" /><span>{displayValue(entry.description ?? entry.transaction ?? entry.statement, "Ledger evidence")}</span><span>{displayValue(entry.date ?? entry.transaction_date)}</span></div>)}</div>
        : <p className="evidence-unavailable">Evidence details are not included in this API response.</p>}
    </div>
  </article>;
}
