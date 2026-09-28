"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiRecord, DashboardData, apiRequest, displayValue, formatMoney, isRecord, titleCase } from "@/lib/api";
import { ErrorState, LoadingState, useApi } from "@/components/ApiState";
import { Icon } from "@/components/Icons";

function read(record: ApiRecord | undefined, key: string): unknown {
  return record?.[key];
}

function safeExternalLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function DashboardPage() {
  const { data, error, loading, reload } = useApi<DashboardData>("/api/dashboard");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const metrics = isRecord(data?.metrics) ? data.metrics : {};
  const review = isRecord(data?.review) ? data.review : null;
  const whatsapp = isRecord(data?.whatsapp) ? data.whatsapp : null;
  const activity = Array.isArray(data?.activity) ? data.activity.filter(isRecord) : [];
  const userName = displayValue(data?.user_name ?? (isRecord(data?.user) ? data.user.name : undefined), "there");
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
  const dateLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()).toUpperCase();
  const reviewId = review ? displayValue(review.id ?? review.review_id, "") : "";

  useEffect(() => {
    setSelectedCategory("");
    setReviewMessage("");
  }, [reviewId]);

  async function confirmReview(action: "confirm" | "dismiss") {
    if (!review) return;
    setReviewBusy(true);
    setReviewMessage("");
    try {
      const id = displayValue(review.id ?? review.review_id, "");
      if (!id) throw new Error("The review is missing its identifier. Refresh and try again.");
      const suggestedCategory = displayValue(review.suggested_category ?? review.category, "Uncategorized");
      const body = action === "confirm" ? { category: selectedCategory || suggestedCategory } : {};
      await apiRequest(`/api/memory/reviews/${encodeURIComponent(id)}/${action}`, { method: "POST", body: JSON.stringify(body) });
      setReviewMessage(action === "confirm" ? "Confirmed — this will guide future suggestions." : "Suggestion dismissed.");
      reload();
    } catch (reason) {
      setReviewMessage(reason instanceof Error ? reason.message : "The review could not be updated.");
    } finally {
      setReviewBusy(false);
    }
  }

  return <div className="page-wrap dashboard-page">
    <div className="page-heading dashboard-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> {dateLabel}</div><h1>{greeting}{userName !== "there" ? `, ${userName}` : ""}</h1><p>Here&apos;s what&apos;s happening with your books.</p></div><Link href="/upload" className="button button-primary"><Icon name="plus" size={17} /> Upload statement</Link></div>

    {error && <ErrorState message={error} onRetry={reload} />}
    {loading && <LoadingState label="Connecting to your ledger…" />}
    {!loading && !error && <>
      <section className="metrics-grid" aria-label="Business metrics">
        <MetricCard label="Net cash flow" value={formatMoney(read(metrics, "net_cash_flow"), displayValue(metrics.currency, "INR"))} change={read(metrics, "net_cash_flow_change")} icon="swap" tone="mint" />
        <MetricCard label="Money in" value={formatMoney(read(metrics, "money_in"), displayValue(metrics.currency, "INR"))} caption={displayValue(metrics.money_in_period)} icon="arrow" tone="blue" />
        <MetricCard label="Money out" value={formatMoney(read(metrics, "money_out"), displayValue(metrics.currency, "INR"))} caption={displayValue(metrics.money_out_period)} icon="arrow" tone="peach" outgoing />
        <MetricCard label="Needs a look" value={displayValue(metrics.needs_review)} caption={displayValue(metrics.needs_review_caption, "Uncategorized transactions")} icon="clock" tone="lilac" />
      </section>

      <div className="dashboard-main-grid">
        <section className="panel learning-panel">
          <div className="panel-heading"><div className="panel-title-group"><span className="heading-icon learning-icon"><Icon name="check" size={17} /></span><div><h2>A little smarter, every month</h2><p>Your books are learning from your decisions.</p></div></div><Link className="subtle-link" href="/memory">View memory <Icon name="arrow" size={14} /></Link></div>
          {review ? <div className="review-card">
            <div className="review-top"><span className="review-label"><span className="review-indicator" /> READY FOR YOUR REVIEW</span><span className="confidence">{displayValue(review.confidence, "—")}{typeof review.confidence === "number" ? "%" : ""} confidence</span></div>
            <h3>{displayValue(review.title, "A bookkeeping suggestion")}</h3>
            <p className="review-description">{displayValue(review.description, "A new suggestion is ready. Review the supporting evidence before confirming.")}</p>
            <div className="review-suggestion">
              <div className="suggestion-avatar">{displayValue(review.counterparty ?? review.merchant, "?").slice(0, 1).toUpperCase()}</div>
              <div className="suggestion-copy"><strong>{displayValue(review.counterparty ?? review.merchant, "Counterparty")}</strong><span>{displayValue(review.suggested_category ?? review.category, "Suggested category")}{review.evidence ? ` · ${displayValue(review.evidence)}` : ""}</span></div>
              <span className="suggestion-category">{displayValue(review.suggested_category ?? review.category, "Review")}</span>
            </div>
            <label className="review-category-label" htmlFor="review-category">Accounting category</label>
            <select id="review-category" className="review-category-select" value={selectedCategory || displayValue(review.suggested_category ?? review.category, "Uncategorized")} onChange={(event) => setSelectedCategory(event.target.value)}>
              {["Packaging Material", "Raw Material-Dairy", "Raw Material", "Dairy", "Ingredients", "Gas & Fuel", "Electricity", "Sales Income", "Sales", "Other Income", "Rent", "Salaries", "Delivery", "Marketing", "Maintenance", "Bank Charges", "Interest", "Personal Expense", "Meals", "Travel", "Office Supplies", "Software", "Utilities", "Payroll", "Insurance", "General", "Uncategorized"].map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            {reviewMessage && <div className={reviewMessage.startsWith("Confirmed") || reviewMessage.startsWith("Suggestion dismissed") ? "inline-success" : "inline-error"} role="status">{reviewMessage}</div>}
            <div className="review-actions"><button className="button button-primary button-small" disabled={reviewBusy} onClick={() => confirmReview("confirm")}><Icon name="check" size={15} /> {reviewBusy ? "Saving…" : "Confirm & remember"}</button><button className="button button-quiet button-small" disabled={reviewBusy} onClick={() => confirmReview("dismiss")}>Not quite</button><span className="review-footnote"><Icon name="shield" size={13} /> Your books, your call</span></div>
          </div> : <div className="review-empty"><span className="review-empty-icon"><Icon name="check" size={16} /></span><span><strong>{displayValue(data?.review_status, "Nothing to review right now")}</strong><small>New suggestions appear here when the ledger has evidence to share.</small></span><Link href="/memory">Explore memory <Icon name="arrow" size={13} /></Link></div>}
        </section>
      </div>

      <section className="panel activity-panel">
        <div className="panel-heading activity-heading"><div><h2>Recent activity</h2><p>Latest updates from your ledger.</p></div><Link className="subtle-link" href="/transactions">All transactions <Icon name="arrow" size={14} /></Link></div>
        {activity.length ? <div className="activity-list">{activity.slice(0, 5).map((item, index) => <ActivityItem item={item} key={displayValue(item.id, String(index))} />)}</div> : <div className="activity-empty"><span className="activity-empty-icon"><Icon name="clock" size={18} /></span><span><strong>Your activity will show up here</strong><small>Once the API has ledger updates, you&apos;ll see them here.</small></span></div>}
      </section>

      <section className="bottom-callout"><span className="callout-icon"><Icon name="file" size={18} /></span><span><strong>Ready to close the books?</strong><small>Bring in your latest statement to keep everything in one place.</small></span><Link href="/upload" className="button button-secondary button-small">Upload a statement <Icon name="arrow" size={14} /></Link></section>
    </>}
  </div>;
}

function MetricCard({ label, value, change, caption, icon, tone, outgoing }: { label: string; value: string; change?: unknown; caption?: string; icon: "swap" | "arrow" | "clock"; tone: string; outgoing?: boolean }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}><Icon name={icon} size={16} /></span></div><strong className="metric-value">{value}</strong><div className="metric-bottom">{change !== undefined ? <span className="metric-change">{displayValue(change)}</span> : <span className="metric-caption">{caption ?? "Based on connected data"}</span>}{outgoing && <span className="outgoing-indicator">↗</span>}</div></article>;
}

function ActivityItem({ item, index }: { item: ApiRecord; index?: number }) {
  const amount = item.amount;
  return <div className="activity-row"><span className={`activity-dot activity-tone-${(index ?? 0) % 4}`}><Icon name={item.type === "upload" ? "file" : "swap"} size={15} /></span><span className="activity-copy"><strong>{displayValue(item.title ?? item.description ?? item.merchant, "Ledger update")}</strong><small>{displayValue(item.date ?? item.created_at)}{item.status ? ` · ${titleCase(item.status)}` : ""}</small></span><strong className="activity-amount">{amount !== undefined ? formatMoney(amount, displayValue(item.currency, "INR")) : ""}</strong></div>;
}
