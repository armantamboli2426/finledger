"use client";

import { ApiRecord, API_URL, displayValue, isRecord, recordsFrom } from "@/lib/api";
import { EmptyState, ErrorState, LoadingState, useApi } from "@/components/ApiState";
import { Icon } from "@/components/Icons";

export default function ExportsPage() {
  const { data, error, loading, reload } = useApi<unknown>("/api/exports");
  const items = recordsFrom(data);
  return <div className="page-wrap">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> TAKE YOUR DATA WITH YOU</div><h1>Exports</h1><p>Download ledger files made available by your connected account.</p></div></div>
    {error && <ErrorState message={error} onRetry={reload} />}
    {loading && <LoadingState label="Checking for available exports…" />}
    {!loading && !error && items.length === 0 && <div className="panel collection-empty"><EmptyState title="No exports available yet" description="When an export is generated for your account, its download link will appear here." /></div>}
    {!loading && !error && items.length > 0 && <div className="export-list">{items.map((item, index) => <ExportCard key={displayValue(item.id, String(index))} item={item} />)}</div>}
  </div>;
}

function ExportCard({ item }: { item: ApiRecord }) {
  const directLink = typeof item.url === "string" ? item.url : typeof item.download_url === "string" ? item.download_url : "";
  const relativeLink = typeof item.download_path === "string" ? `${API_URL}${item.download_path.startsWith("/") ? "" : "/"}${item.download_path}` : "";
  const link = directLink || relativeLink;
  const safeLink = safeDownloadLink(link);
  return <article className="panel export-card"><span className="export-icon"><Icon name="file" size={20} /></span><div className="export-info"><strong>{displayValue(item.name ?? item.filename, "Ledger export")}</strong><span>{displayValue(item.format, "File")} {item.created_at ? `· ${displayValue(item.created_at)}` : ""}</span></div>{safeLink ? <a href={safeLink} className="button button-secondary button-small" rel="noreferrer"><Icon name="download" size={15} /> Download</a> : <span className="export-unavailable">Download link unavailable</span>}
  </article>;
}

function safeDownloadLink(link: string): string | null {
  if (!link) return null;
  try {
    const url = new URL(link, `${API_URL}/`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
