"use client";

import Link from "next/link";
import { CollectionView } from "@/components/CollectionView";
import { Icon } from "@/components/Icons";
import { displayValue, itemId } from "@/lib/api";
import type { ApiRecord } from "@/lib/api";

export default function StatementsPage() {
  return <CollectionView endpoint="/api/statements" title="Statements" description="Every statement, together in one place." columns={[
    { label: "Statement", key: "filename" },
    { label: "Account", key: "account_name" },
    { label: "Period", key: "period" },
    { label: "Uploaded", key: "uploaded_at", kind: "date" },
    { label: "Status", key: "status", kind: "status" }
  ]} emptyTitle="No statements yet" emptyDescription="When you upload a bank statement, it will show up here." action={<Link href="/upload" className="button button-primary"><Icon name="plus" size={17} /> Upload statement</Link>} detailHref={(item: ApiRecord) => `/statements/${encodeURIComponent(itemId(item, 0))}`} />
}
