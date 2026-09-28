"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ApiRecord, API_URL, displayValue, formatMoney, getBusinessId, isRecord, recordsFrom, titleCase } from "@/lib/api";
import { ErrorState, LoadingState, useApi } from "@/components/ApiState";
import { Icon } from "@/components/Icons";

export default function StatementDetailPage() {
  const params = useParams<{ id: string }>();
  const id = encodeURIComponent(params.id);
  const { data, error, loading, reload } = useApi<unknown>(`/api/statements/${id}`);
  const { data: breakdownData, loading: breakdownLoading } = useApi<unknown>(`/api/statements/${id}/breakdown`);
  const { data: transactionData, error: transactionError, loading: transactionsLoading, reload: reloadTransactions } = useApi<unknown>(`/api/statements/${id}/transactions`);

  const [modeFilter, setModeFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [activeTab, setActiveTab] = useState<"vendors" | "modes" | "transactions">("vendors");

  const statement = isRecord(data) && isRecord(data.statement) ? data.statement : isRecord(data) ? data : {};
  const transactions = recordsFrom(transactionData);
  const breakdown = isRecord(breakdownData) ? breakdownData : {};
  const summary = isRecord(breakdown.summary) ? breakdown.summary : {};
  const byPaymentMode = Array.isArray(breakdown.by_payment_mode) ? (breakdown.by_payment_mode as ApiRecord[]) : [];
  const byVendor = Array.isArray(breakdown.by_vendor) ? (breakdown.by_vendor as ApiRecord[]) : [];
  const currency = displayValue(summary.currency, "INR");

  const filteredVendors = byVendor.filter((v) => {
    const modes = Array.isArray(v.payment_modes) ? v.payment_modes.map(String) : [String(v.primary_payment_mode ?? "")];
    const matchMode = modeFilter === "ALL" || modes.includes(modeFilter);
    const vType = String(v.payment_type ?? "");
    const matchType = typeFilter === "ALL" || vType === typeFilter || vType === "Sent & Received";
    return matchMode && matchType;
  });

  const filteredTransactions = transactions.filter((tx) => {
    const m = String(tx.payment_mode ?? tx.subcategory ?? "OTHER");
    const t = Number(tx.amount ?? 0) > 0 ? "Received" : "Sent";
    const matchMode = modeFilter === "ALL" || m === modeFilter;
    const matchType = typeFilter === "ALL" || t === typeFilter;
    return matchMode && matchType;
  });

  return (
    <div className="page-wrap">
      <div className="page-heading detail-heading">
        <div>
          <div className="eyebrow">
            <Link href="/statements">STATEMENTS</Link>
            <span className="eyebrow-line" /> ALGORITHMIC BREAKDOWN
          </div>
          <h1>{displayValue(statement.filename ?? statement.name, "Statement detail")}</h1>
          <p>Sorted by Payment Mode → Payment Type (Sent / Received) → Categorized Vendor (Each Vendor Separate).</p>
        </div>
        <div className="provider-links">
          <a
            href={`${API_URL}/api/statements/${id}/export?business_id=${encodeURIComponent(getBusinessId())}&format=pdf`}
            className="button button-primary"
          >
            <Icon name="download" size={15} /> Download Categorized PDF
          </a>
          <a
            href={`${API_URL}/api/statements/${id}/export?business_id=${encodeURIComponent(getBusinessId())}&format=csv`}
            className="button button-secondary"
          >
            <Icon name="download" size={15} /> Export CSV
          </a>
          <Link href="/statements" className="button button-secondary">
            <Icon name="chevron" size={15} className="back-chevron" /> All statements
          </Link>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={reload} />}
      {loading && <LoadingState label="Loading statement…" />}

      {!loading && !error && (
        <>
          {transactionError && <ErrorState message={transactionError} onRetry={reloadTransactions} />}

          {/* Grand Sent / Received / Vendors Summary Cards */}
          <section className="metric-grid">
            <div className="panel metric-card">
              <div className="metric-top">
                <span>Total Sent (Debit)</span>
                <span className="status-tag status-needs-review">{displayValue(summary.sent_count, "0")} Sent</span>
              </div>
              <strong>{formatMoney(summary.total_sent ?? 0, currency)}</strong>
              <small>Total money paid out across all vendors</small>
            </div>
            <div className="panel metric-card">
              <div className="metric-top">
                <span>Total Received (Credit)</span>
                <span className="status-tag status-confirmed">{displayValue(summary.received_count, "0")} Received</span>
              </div>
              <strong>{formatMoney(summary.total_received ?? 0, currency)}</strong>
              <small>Total money received across all modes</small>
            </div>
            <div className="panel metric-card">
              <div className="metric-top">
                <span>Net Cash Flow</span>
                <span className="status-tag status-categorized">{ titleCase(statement.status ?? "completed") }</span>
              </div>
              <strong>{formatMoney(summary.net_flow ?? 0, currency)}</strong>
              <small>Received minus Sent for this statement</small>
            </div>
            <div className="panel metric-card">
              <div className="metric-top">
                <span>Unique Vendors</span>
                <span className="status-tag status-categorized">{displayValue(summary.payment_modes_used, "0")} Modes</span>
              </div>
              <strong>{displayValue(summary.unique_vendors, String(byVendor.length))} Vendors</strong>
              <small>{displayValue(summary.total_transactions, String(transactions.length))} total transactions</small>
            </div>
          </section>

          {/* Filter & View Switcher Toolbar */}
          <section className="panel table-panel" style={{ marginTop: "18px" }}>
            <div className="table-toolbar" style={{ flexWrap: "wrap", gap: "12px" }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
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
                <button
                  type="button"
                  className={`button button-small ${activeTab === "transactions" ? "button-primary" : "button-secondary"}`}
                  onClick={() => setActiveTab("transactions")}
                >
                  All Transactions ({filteredTransactions.length})
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
              </div>
            </div>

            {(transactionsLoading || breakdownLoading) && <LoadingState label="Computing algorithmic breakdown…" />}

            {/* TAB 1: Each Vendor Separate */}
            {!transactionsLoading && !breakdownLoading && activeTab === "vendors" && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Vendor Name</th>
                      <th>Payment Mode</th>
                      <th>Type</th>
                      <th>Category</th>
                      <th>Txns</th>
                      <th>Total Sent (Debit)</th>
                      <th>Total Received (Credit)</th>
                      <th>Net Total</th>
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

            {/* TAB 2: By Payment Mode */}
            {!transactionsLoading && !breakdownLoading && activeTab === "modes" && (
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

            {/* TAB 3: All Transactions Sorted by Mode -> Type -> Vendor */}
            {!transactionsLoading && !breakdownLoading && activeTab === "transactions" && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Payment Mode</th>
                      <th>Type</th>
                      <th>Vendor</th>
                      <th>Description</th>
                      <th>Category</th>
                      <th>Sent (Debit)</th>
                      <th>Received (Credit)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((item: ApiRecord, index: number) => {
                      const amt = Number(item.amount ?? 0);
                      const isReceived = amt > 0;
                      return (
                        <tr key={displayValue(item.id, String(index))}>
                          <td>{displayValue(item.date ?? item.transaction_date)}</td>
                          <td><span className="status-tag status-categorized">{displayValue(item.payment_mode ?? item.subcategory, "OTHER")}</span></td>
                          <td>
                            <span className={`status-tag ${isReceived ? "status-confirmed" : "status-needs-review"}`}>
                              {isReceived ? "Received" : "Sent"}
                            </span>
                          </td>
                          <td><strong>{displayValue(item.vendor)}</strong></td>
                          <td>{displayValue(item.description ?? item.merchant)}</td>
                          <td>{displayValue(item.category)}</td>
                          <td>{!isReceived ? formatMoney(Math.abs(amt), displayValue(item.currency, "INR")) : "—"}</td>
                          <td>{isReceived ? formatMoney(amt, displayValue(item.currency, "INR")) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
