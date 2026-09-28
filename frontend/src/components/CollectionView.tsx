"use client";

import Link from "next/link";
import { ApiRecord, displayValue, formatMoney, itemId, recordsFrom, titleCase } from "@/lib/api";
import { EmptyState, ErrorState, LoadingState, useApi } from "@/components/ApiState";
import { Icon } from "@/components/Icons";

export interface Column {
  label: string;
  key: string;
  kind?: "money" | "status" | "date";
}

export function CollectionView({ endpoint, title, description, columns, emptyTitle, emptyDescription, detailHref, action }: {
  endpoint: string;
  title: string;
  description: string;
  columns: Column[];
  emptyTitle: string;
  emptyDescription: string;
  detailHref?: (item: ApiRecord) => string;
  action?: React.ReactNode;
}) {
  const { data, error, loading, reload } = useApi<unknown>(endpoint);
  const items = recordsFrom(data);
  return <div className="page-wrap">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR WORKSPACE</div><h1>{title}</h1><p>{description}</p></div>{action}</div>
    {error && <ErrorState message={error} onRetry={reload} />}
    {loading && <LoadingState />}
    {!loading && !error && items.length === 0 && <div className="panel collection-empty"><EmptyState title={emptyTitle} description={emptyDescription} /></div>}
    {!loading && !error && items.length > 0 && <div className="panel table-panel"><div className="table-toolbar"><span>{items.length} {items.length === 1 ? "record" : "records"}</span><button className="icon-button search-button" aria-label="Search unavailable"><Icon name="search" size={17} /></button></div><div className="table-scroll"><table><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}{detailHref && <th aria-label="Details" />}</tr></thead><tbody>{items.map((item, index) => <tr key={itemId(item, index)}>{columns.map((column) => {
      const value = item[column.key];
      const rendered = column.kind === "money" ? formatMoney(value, displayValue(item.currency, "INR")) : column.kind === "status" ? titleCase(value) : displayValue(value);
      return <td key={column.key}>{column.kind === "status" ? <span className={`status-tag status-${displayValue(value, "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{rendered}</span> : rendered}</td>;
    })}{detailHref && <td className="row-link-cell"><Link href={detailHref(item)} aria-label={`Open record ${itemId(item, index)}`}><Icon name="chevron" size={16} /></Link></td>}</tr>)}</tbody></table></div></div>}
  </div>;
}
