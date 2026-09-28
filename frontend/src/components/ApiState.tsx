"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { ReactNode } from "react";

export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchApi<T>(path, controller.signal)
      .then(setData)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Something went wrong while loading this data.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path]);

  const reload = () => {
    setData(null);
    setError(null);
    setLoading(true);
    fetchApi<T>(path)
      .then(setData)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Something went wrong while loading this data."))
      .finally(() => setLoading(false));
  };

  return { data, error, loading, reload };
}

async function fetchApi<T>(path: string, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>(path, { signal });
}

export function LoadingState({ label = "Loading your ledger…" }: { label?: string }) {
  return <div className="state-card" role="status"><span className="spinner" />{label}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="state-card error-state" role="alert"><div><strong>We couldn’t load this view</strong><p>{message}</p></div>{onRetry && <button className="button button-secondary button-small" onClick={onRetry}>Try again</button>}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">↗</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
