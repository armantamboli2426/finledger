"use client";

import { useState } from "react";
import { ApiError, ApiRecord, API_URL, apiRequest, displayValue, formatMoney, getBusinessId, isRecord, itemId, recordsFrom, titleCase } from "@/lib/api";
import { EmptyState, ErrorState, LoadingState, useApi } from "@/components/ApiState";
import { Icon } from "@/components/Icons";

const categories = [
  "Sales Income", "Meals", "Travel", "Office Supplies", "Software", "Utilities",
  "Payroll", "Insurance", "Rent", "Packaging Material", "Raw Material-Dairy",
  "Gas & Fuel", "Electricity", "Bank Charges", "General", "Uncategorized"
];

export default function TransactionsPage() {
  const { data, error, loading, reload } = useApi<unknown>("/api/transactions");
  const transactions = recordsFrom(data);
  const root = isRecord(data) ? data : {};
  const summary = isRecord(root.summary) ? root.summary : {};
  const byPaymentMode = Array.isArray(root.by_payment_mode) ? (root.by_payment_mode as ApiRecord[]) : [];
  const byVendor = Array.isArray(root.by_vendor) ? (root.by_vendor as ApiRecord[]) : [];
  const currency = displayValue(summary.currency, "INR");

  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ id: string; text: string; error: boolean } | null>(null);
  const [modeFilter, setModeFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [activeTab, setActiveTab] = useState<"transactions" | "vendors" | "modes">("transactions");

  async function saveCategory(transaction: ApiRecord, action: "confirm" | "reclassify", index: number) {
    const id = itemId(transaction, index);
    const category = selected[id] ?? displayValue(transaction.final_category ?? transaction.category ?? transaction.suggested_category, "Uncategorized");
    if (category === "—" || !category.trim()) {
      setMessage({ id, text: "Select a category before confirming.", error: true });
      return;
    }
    setBusyId(id);
    setMessage(null);
    try {
      await apiRequest(`/api/transactions/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body: JSON.stringify({ category, business_id: getBusinessId() })
      });
      setMessage({ id, text: "Saved & applied to all matching vendor transactions!", error: false });
      reload();
    } catch (reason) {
      const text = reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : "Could not save this category.";
      setMessage({ id, text, error: true });
    } finally {
      setBusyId(null);
    }
  }

  const filteredTransactions = transactions.filter((tx) => {
    const m = String(tx.payment_mode ?? tx.subcategory ?? "OTHER");
    const t = Number(tx.amount ?? 0) > 0 ? "Received" : "Sent";
    const matchMode = modeFilter === "ALL" || m === modeFilter;
    const matchType = typeFilter === "ALL" || t === typeFilter;
    return matchMode && matchType;
  });

  const filteredVendors = byVendor.filter((v) => {
    const modes = Array.isArray(v.payment_modes) ? v.payment_modes.map(String) : [String(v.primary_payment_mode ?? "")];
    const matchMode = modeFilter === "ALL" || modes.includes(modeFilter);
    const vType = String(v.payment_type ?? "");
    const matchType = typeFilter === "ALL" || vType === typeFilter || vType === "Sent & Received";
    return matchMode && matchType;
  });

  return (
    <div className="page-wrap">
      <div className="page-heading detail-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> YOUR BOOKS · ALGORITHMIC LEDGER</div>
          <h1>Transactions & Vendor Ledger</h1>
          <p>Sorted by Payment Mode → Payment Type (Sent / Received) → Categorized Vendor (Each Vendor Separate).</p>
        </div>
        {transactions.length > 0 && (
          <div className="provider-links">
            <a
              href={`${API_URL}/api/transactions/export?business_id=${encodeURIComponent(getBusinessId())}&format=pdf`}
              className="button button-primary"
            >
              <Icon name="download" size={15} /> Categorized PDF (All Vendors)
            </a>
            <a
              href={`${API_URL}/api/transactions/export?business_id=${encodeURIComponent(getBusinessId())}&format=csv`}
              className="button button-secondary"
            >
              <Icon name="download" size={15} /> Export CSV
            </a>
          </div>
        )}
      </div>

      {error && <ErrorState message={error} onRetry={reload} />}
      {loading && <LoadingState label="Loading transactions…" />}
      {!loading && !error && transactions.length === 0 && (
        <div className="panel collection-empty">
          <EmptyState title="No transactions to show" description="Upload a statement to extract and categorize its transactions." />
        </div>
      )}

      {!loading && !error && transactions.length > 0 && (
        <>
          {/* Grand Sent / Received / Vendors Summary Cards */}
          <section className="metric-grid" style={{ marginBottom: "18px" }}>
            <div className="panel metric-card">
              <div className="metric-top">
                <span>Total Sent (Debit)</span>
                <span className="status-tag status-needs-review">{displayValue(summary.sent_count, "0")} Sent</span>
              </div>
              <strong>{formatMoney(summary.total_sent ?? 0, currency)}</strong>
              <small>Money paid out across all vendors</small>
            </div>
            <div className="panel metric-card">
              <div className="metric-top">
                <span>Total Received (Credit)</span>
                <span className="status-tag status-confirmed">{displayValue(summary.received_count, "0")} Received</span>
              </div>
              <strong>{formatMoney(summary.total_received ?? 0, currency)}</strong>
              <small>Money received across all modes</small>
            </div>
            <div className="panel metric-card">
              <div className="metric-top">
                <span>Net Cash Flow</span>
                <span className="status-tag status-categorized">Net Balance</span>
              </div>
              <strong>{formatMoney(summary.net_flow ?? 0, currency)}</strong>
              <small>Total Received minus Total Sent</small>
            </div>
            <div className="panel metric-card">
              <div className="metric-top">
                <span>Unique Vendors</span>
                <span className="status-tag status-categorized">{displayValue(summary.payment_modes_used, "0")} Modes</span>
              </div>
              <strong>{displayValue(summary.unique_vendors, String(byVendor.length))} Vendors</strong>
              <small>{transactions.length} total transactions</small>
            </div>
          </section>

          <div className="panel table-panel">
            <div className="table-toolbar" style={{ flexWrap: "wrap", gap: "12px" }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`button button-small ${activeTab === "transactions" ? "button-primary" : "button-secondary"}`}
                  onClick={() => setActiveTab("transactions")}
                >
                  Sorted Ledger ({filteredTransactions.length})
                </button>
                <button
                  type="button"
                  className={`button button-small ${activeTab === "vendors" ? "button-primary" : "button-secondary"}`}
                  onClick={() => setActiveTab("vendors")}
                >
                  Each Vendor Separate ({filteredVendors.length})
                </button>
                <button
                  type="button"
                  className={`button button-small ${activeTab === "modes" ? "button-primary" : "button-secondary"}`}
                  onClick={() => setActiveTab("modes")}
                >
                  By Payment Mode ({byPaymentMode.length})
                </button>
              </div>

              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <select
                  className="review-category-select"
                  value={modeFilter}
                  onChange={(e) => setModeFilter(e.target.value)}
                  aria-label="Filter by Payment Mode"
                >
                  <option value="ALL">All Payment Modes</option>
                  {byPaymentMode.map((m) => {
                    const modeName = String(m.payment_mode ?? "");
                    return (
                      <option key={modeName} value={modeName}>
                        {modeName} ({String(m.transaction_count ?? 0)})
                      </option>
                    );
                  })}
                </select>

                <select
                  className="review-category-select"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  aria-label="Filter by Payment Type"
                >
                  <option value="ALL">Sent & Received (All)</option>
                  <option value="Sent">Sent (Debit Only)</option>
                  <option value="Received">Received (Credit Only)</option>
                </select>

                <button className="button button-secondary button-small" onClick={reload}>Refresh</button>
              </div>
            </div>

            {/* TAB 1: Sorted Transactions Ledger */}
            {activeTab === "transactions" && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Mode</th>
                      <th>Type</th>
                      <th>Vendor & Narration</th>
                      <th>Category</th>
                      <th>Sent / Received</th>
                      <th>Confidence</th>
                      <th>Memory</th>
                      <th>Status / Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((transaction, index) => {
                      const id = itemId(transaction, index);
                      const category = displayValue(transaction.final_category ?? transaction.category ?? transaction.suggested_category, "Uncategorized");
                      const confidenceValue = transaction.confidence;
                      const confidence = typeof confidenceValue === "number" ? (confidenceValue <= 1 ? confidenceValue * 100 : confidenceValue) : null;
                      const needsReview = transaction.review_required === true || transaction.requires_review === true || (transaction.confirmed === false && confidence !== null && confidence < 70);
                      const memoryUsed = transaction.memory_used === true;
                      const selectedCategory = selected[id] ?? category;
                      const amt = Number(transaction.amount ?? 0);
                      const isReceived = amt > 0;
                      const pMode = displayValue(transaction.payment_mode ?? transaction.subcategory, "OTHER");
                      return (
                        <tr key={id}>
                          <td>{displayValue(transaction.date)}</td>
                          <td><span className="status-tag status-categorized">{pMode}</span></td>
                          <td>
                            <span className={`status-tag ${isReceived ? "status-confirmed" : "status-needs-review"}`}>
                              {isReceived ? "Received" : "Sent"}
                            </span>
                          </td>
                          <td>
                            <strong>{displayValue(transaction.vendor)}</strong>
                            <div className="transaction-vendor">{displayValue(transaction.description)}</div>
                          </td>
                          <td>
                            <select
                              className="review-category-select transaction-category-select"
                              aria-label={`Category for ${displayValue(transaction.vendor)}`}
                              value={selectedCategory}
                              onChange={(event) => setSelected((previous) => ({ ...previous, [id]: event.target.value }))}
                            >
                              {Array.from(new Set([...categories, category])).map((item) => (
                                <option key={item} value={item}>{item}</option>
                              ))}
                            </select>
                          </td>
                          <td>{formatMoney(transaction.amount, displayValue(transaction.currency, "INR"))}</td>
                          <td>{confidence === null ? "—" : `${Math.round(confidence)}%`}</td>
                          <td>{memoryUsed ? <span className="status-tag status-confirmed" title={displayValue(transaction.memory_summary)}>Recalled</span> : "—"}</td>
                          <td>
                            {(needsReview || selected[id] !== undefined) ? (
                              <div className="transaction-review-actions">
                                <button
                                  className="button button-primary button-small"
                                  disabled={busyId === id}
                                  onClick={() => saveCategory(transaction, selectedCategory === category ? "confirm" : "reclassify", index)}
                                >
                                  {busyId === id ? "Saving…" : "Confirm Vendor"}
                                </button>
                                {message?.id === id && (
                                  <span className={message.error ? "inline-error" : "inline-success"} role={message.error ? "alert" : "status"}>
                                    {message.text}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className={`status-tag status-${displayValue(transaction.status, transaction.confirmed ? "confirmed" : "categorized").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                                {transaction.confirmed ? "Confirmed" : titleCase(displayValue(transaction.status, "Categorized"))}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 2: Each Vendor Separate Breakdown */}
            {activeTab === "vendors" && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Vendor Name</th>
                      <th>Payment Mode</th>
                      <th>Type (Sent / Rcvd)</th>
                      <th>Category</th>
                      <th>Txns</th>
                      <th>Total Sent (Debit)</th>
                      <th>Total Received (Credit)</th>
                      <th>Net Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVendors.map((v, i) => {
                      const modes = Array.isArray(v.payment_modes) ? v.payment_modes.join(", ") : displayValue(v.primary_payment_mode);
                      const pType = displayValue(v.payment_type, "Sent");
                      return (
                        <tr key={displayValue(v.normalized_vendor, String(i))}>
                          <td>
                            <strong>{displayValue(v.vendor)}</strong>
                            <div className="transaction-vendor">
                              {displayValue(v.first_date)} → {displayValue(v.last_date)}
                            </div>
                          </td>
                          <td><span className="status-tag status-categorized">{modes}</span></td>
                          <td>
                            <span className={`status-tag ${pType === "Received" ? "status-confirmed" : pType === "Sent" ? "status-needs-review" : "status-categorized"}`}>
                              {pType}
                            </span>
                          </td>
                          <td><strong>{displayValue(v.category)}</strong></td>
                          <td>{displayValue(v.transaction_count)}</td>
                          <td>{Number(v.total_sent ?? 0) > 0 ? formatMoney(v.total_sent, currency) : "—"}</td>
                          <td>{Number(v.total_received ?? 0) > 0 ? formatMoney(v.total_received, currency) : "—"}</td>
                          <td><strong>{formatMoney(v.net_amount ?? 0, currency)}</strong></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 3: By Payment Mode Breakdown */}
            {activeTab === "modes" && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Payment Mode</th>
                      <th>Total Txns</th>
                      <th>Unique Vendors</th>
                      <th>Sent Txns</th>
                      <th>Total Sent (Debit)</th>
                      <th>Received Txns</th>
                      <th>Total Received (Credit)</th>
                      <th>Net Flow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byPaymentMode.map((m, i) => (
                      <tr key={displayValue(m.payment_mode, String(i))}>
                        <td><strong>{displayValue(m.payment_mode)}</strong></td>
                        <td>{displayValue(m.transaction_count)}</td>
                        <td>{displayValue(m.unique_vendors)}</td>
                        <td>{displayValue(m.sent_count)}</td>
                        <td>{formatMoney(m.total_sent ?? 0, currency)}</td>
                        <td>{displayValue(m.received_count)}</td>
                        <td>{formatMoney(m.total_received ?? 0, currency)}</td>
                        <td><strong>{formatMoney(m.net_amount ?? 0, currency)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="transaction-memory-note">
              <Icon name="shield" size={15} /> Confirming a vendor&apos;s category automatically updates all matching transactions for that vendor and saves it to business memory.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
