const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
const fallbackApiUrl = typeof window === "undefined"
  ? (process.env.NODE_ENV === "production" ? "" : "http://localhost:8000")
  : (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? `http://${window.location.hostname}:8000`
      : "");
export const API_URL = (configuredApiUrl || fallbackApiUrl).replace(/\/$/, "");
export const DEFAULT_BUSINESS_ID = process.env.NEXT_PUBLIC_BUSINESS_ID ?? "demo-business";
const BUSINESS_STORAGE_KEY = "finledger.business_id";

export type ApiRecord = Record<string, unknown>;

export interface DashboardData extends ApiRecord {
  metrics?: ApiRecord;
  review?: ApiRecord | null;
  whatsapp?: ApiRecord | null;
  activity?: ApiRecord[];
}

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

export function getBusinessId(): string {
  if (typeof window !== "undefined") {
    return window.localStorage.getItem(BUSINESS_STORAGE_KEY) || DEFAULT_BUSINESS_ID;
  }
  return DEFAULT_BUSINESS_ID;
}

export function persistBusinessId(value: string): void {
  if (typeof window !== "undefined" && value.trim()) {
    window.localStorage.setItem(BUSINESS_STORAGE_KEY, value.trim());
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    headers.set("X-Business-ID", getBusinessId());
    let body = init?.body;
    if (body instanceof FormData && path.startsWith("/api/") && !body.has("business_id")) {
      body.append("business_id", getBusinessId());
    }
    if (body !== undefined && !(body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const url = new URL(API_URL ? `${API_URL}${path}` : path, typeof window !== "undefined" ? window.location.origin : "http://localhost:8000");
    if (path.startsWith("/api/") && !url.searchParams.has("business_id")) {
      url.searchParams.set("business_id", getBusinessId());
    }
    response = await fetch(url, {
      ...init,
      body,
      headers,
      cache: "no-store",
      credentials: "include"
    });
  } catch {
    throw new ApiError(`Could not connect to the FINLEDGER API at ${API_URL || "the configured backend"}. Check the service and NEXT_PUBLIC_API_URL.`);
  }

  if (!response.ok) {
    const body = await response.text();
    let message = body || `The API returned ${response.status}.`;
    try {
      const payload: unknown = JSON.parse(body);
      if (isRecord(payload)) message = displayValue(payload.detail ?? payload.message, message);
    } catch {
      message = body || `The API returned ${response.status}.`;
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function recordsFrom(data: unknown): ApiRecord[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data)) {
    for (const key of ["items", "results", "data", "statements", "transactions", "memories", "entries", "exports", "integrations"]) {
      if (Array.isArray(data[key])) return (data[key] as unknown[]).filter(isRecord);
    }
  }
  return [];
}

export function isRecord(value: unknown): value is ApiRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function displayValue(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);
  return fallback;
}

export function formatMoney(value: unknown, currency = "INR"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return displayValue(value);
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
  }
}

export function titleCase(value: unknown): string {
  return displayValue(value, "Unknown").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function itemId(item: ApiRecord, fallback: number): string {
  return displayValue(item.id ?? item.statement_id ?? item.transaction_id ?? item.key, String(fallback));
}
