"use client";

import { FormEvent, useEffect, useState } from "react";
import { ApiRecord, apiRequest, displayValue, isRecord, recordsFrom } from "@/lib/api";
import { ErrorState, LoadingState, useApi } from "@/components/ApiState";
import { Icon } from "@/components/Icons";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";
const OPENAI_MODEL = "gpt-4o-mini";

type LlmProvider = "groq" | "openai" | "openai_compatible";

function asLlmProvider(value: unknown): LlmProvider {
  if (value === "openai" || value === "openai_compatible" || value === "groq") return value;
  return "groq";
}

export default function SettingsPage() {
  const { data, error, loading, reload } = useApi<unknown>("/api/integrations");
  const [configuration, setConfiguration] = useState<ApiRecord | null>(null);
  const [hindsightUrl, setHindsightUrl] = useState("");
  const [hindsightKey, setHindsightKey] = useState("");
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("groq");
  const [llmKey, setLlmKey] = useState("");
  const [llmModel, setLlmModel] = useState(GROQ_MODEL);
  const [llmBaseUrl, setLlmBaseUrl] = useState(GROQ_CHAT_URL);
  const [savingProvider, setSavingProvider] = useState(false);
  const [providerMessage, setProviderMessage] = useState("");
  const [providerError, setProviderError] = useState("");
  const [testingProvider, setTestingProvider] = useState("");
  const integrations = recordsFrom(data);
  const memoryMode = displayValue(integrations.find((item) => displayValue(item.name).toLowerCase().includes("hindsight"))?.mode, "");

  function applyLoadedLlm(llm: ApiRecord) {
    const provider = asLlmProvider(llm.provider);
    setLlmProvider(provider);
    if (typeof llm.model === "string" && llm.model) setLlmModel(llm.model);
    if (typeof llm.base_url === "string" && llm.base_url) setLlmBaseUrl(llm.base_url);
    else if (provider === "groq") setLlmBaseUrl(GROQ_CHAT_URL);
    else if (provider === "openai") setLlmBaseUrl(OPENAI_CHAT_URL);
  }

  function changeLlmProvider(next: LlmProvider) {
    setLlmProvider(next);
    if (next === "groq") {
      setLlmBaseUrl(GROQ_CHAT_URL);
      if (llmModel === OPENAI_MODEL || !llmModel) setLlmModel(GROQ_MODEL);
    } else if (next === "openai") {
      setLlmBaseUrl(OPENAI_CHAT_URL);
      if (llmModel === GROQ_MODEL) setLlmModel(OPENAI_MODEL);
    }
  }

  async function loadConfiguration() {
    const result: unknown = await apiRequest("/api/integrations/configuration");
    if (!isRecord(result)) throw new Error("The API returned invalid integration configuration.");
    setConfiguration(result);
    if (isRecord(result.llm)) applyLoadedLlm(result.llm);
  }

  useEffect(() => {
    void loadConfiguration().catch((reason: unknown) => {
      setProviderError(reason instanceof Error ? reason.message : "Could not load integration configuration.");
    });
  }, []);

  async function saveProviders(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProvider(true);
    setProviderError("");
    setProviderMessage("");
    try {
      const update: Record<string, string> = {
        llm_provider: llmProvider,
        llm_model: llmModel.trim(),
        llm_base_url: llmBaseUrl.trim()
      };
      if (hindsightUrl.trim()) update.hindsight_url = hindsightUrl.trim();
      if (hindsightKey.trim()) update.hindsight_api_key = hindsightKey.trim();
      if (llmKey.trim()) update.llm_api_key = llmKey.trim();
      const result: unknown = await apiRequest("/api/integrations/configuration", {
        method: "PUT",
        body: JSON.stringify(update)
      });
      if (!isRecord(result)) throw new Error("The API returned invalid integration status.");
      setConfiguration(result);
      setHindsightKey("");
      setLlmKey("");
      if (isRecord(result.llm)) applyLoadedLlm(result.llm);
      setProviderMessage("Provider settings saved encrypted on the backend. Secret values were not returned.");
      reload();
    } catch (reason) {
      setProviderError(reason instanceof Error ? reason.message : "Could not save provider settings.");
    } finally {
      setSavingProvider(false);
    }
  }

  async function clearProvider(provider: "clear_hindsight" | "clear_llm") {
    setSavingProvider(true);
    setProviderError("");
    setProviderMessage("");
    try {
      const result: unknown = await apiRequest("/api/integrations/configuration", {
        method: "PUT",
        body: JSON.stringify({ [provider]: true })
      });
      if (!isRecord(result)) throw new Error("The API returned invalid integration status.");
      setConfiguration(result);
      setProviderMessage("Saved provider credentials were removed.");
      reload();
    } catch (reason) {
      setProviderError(reason instanceof Error ? reason.message : "Could not remove provider credentials.");
    } finally {
      setSavingProvider(false);
    }

  }

  async function testProvider(provider: "hindsight" | "llm") {
    setTestingProvider(provider);
    setProviderError("");
    setProviderMessage("");
    try {
      const result: unknown = await apiRequest("/api/integrations/test", {
        method: "POST",
        body: JSON.stringify({ provider })
      });
      if (!isRecord(result) || result.connected !== true) throw new Error("Provider authentication could not be verified.");
      setProviderMessage(displayValue(result.message, "Provider connection verified."));
      reload();
    } catch (reason) {
      setProviderError(reason instanceof Error ? reason.message : "Provider connection test failed.");
    } finally {
      setTestingProvider("");
    }
  }

  return <div className="page-wrap">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> SYSTEM CONFIGURATION</div><h1>Settings</h1><p>Integration readiness and server-side configuration. Secrets are never returned to the browser.</p></div></div>
    {error && <ErrorState message={error} onRetry={reload} />}
    {loading && <LoadingState label="Checking integration readiness…" />}
    {!loading && !error && <>
      {memoryMode && <div className="memory-mode-note"><Icon name="shield" size={16} /><span>Business memory mode: <strong>{memoryMode === "hindsight" ? "Hindsight service" : memoryMode === "demo" ? "local database memory" : memoryMode}</strong>. Local demo memory is stored in the configured database.</span></div>}
      <section className="integration-grid" aria-label="Integration readiness">
        {integrations.map((integration, index) => <IntegrationCard key={displayValue(integration.name, String(index))} integration={integration} />)}
      </section>
      <section className="panel integration-instructions">
        <div className="panel-heading"><div className="panel-title-group"><span className="heading-icon settings-heading-icon"><Icon name="settings" size={17} /></span><div><h2>Connect Hindsight and Groq categorization</h2><p>Get credentials from the providers, then save them directly to this business workspace.</p></div></div></div>
        <div className="provider-links">
          <a className="button button-secondary button-small" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get a free Groq API key ↗</a>
          <a className="button button-secondary button-small" href="https://docs.hindsight.vectorize.io/" target="_blank" rel="noreferrer">Hindsight setup and API docs ↗</a>
        </div>
        {providerError && <div className="form-error" role="alert">{providerError}</div>}
        {providerMessage && <div className="inline-success" role="status">{providerMessage}</div>}
        <form className="provider-config-form" onSubmit={saveProviders}>
          <div className="provider-config-block">
            <h3>Hindsight memory</h3>
            <p>Needed if you run a Hindsight API. Paste the HTTPS endpoint and optional API key for this workspace.</p>
            <label className="settings-field"><span>Hindsight API endpoint</span><input type="url" value={hindsightUrl} onChange={(event) => setHindsightUrl(event.target.value)} placeholder="https://your-hindsight-host/v1" autoComplete="url" /></label>
            <label className="settings-field"><span>Hindsight API key (optional)</span><input type="password" value={hindsightKey} onChange={(event) => setHindsightKey(event.target.value)} placeholder={isRecord(configuration?.hindsight) && configuration.hindsight.has_api_key ? "Saved securely; leave blank to keep" : "Paste the key from your Hindsight deployment"} autoComplete="new-password" /></label>
            <small>{isRecord(configuration?.hindsight) && configuration.hindsight.configured ? "Hindsight endpoint and client are configured." : "Not connected yet. Provider credentials are saved encrypted and never shown again."}</small>
            <button type="button" className="button button-secondary button-small" disabled={savingProvider || testingProvider !== ""} onClick={() => void testProvider("hindsight")}>{testingProvider === "hindsight" ? "Testing…" : "Test Hindsight connection"}</button>
            {isRecord(configuration?.hindsight) && configuration.hindsight.has_api_key === true && <button type="button" className="auth-toggle" disabled={savingProvider} onClick={() => void clearProvider("clear_hindsight")}>Remove saved Hindsight credentials</button>}
          </div>
          <div className="provider-config-block">
            <h3>LLM categorization (Groq by default)</h3>
            <p>Low-confidence rows are classified by Groq&apos;s free OpenAI-compatible API. Confirmed Hindsight memory still wins when a vendor is already known.</p>
            <label className="settings-field"><span>Provider</span>
              <select value={llmProvider} onChange={(event) => changeLlmProvider(asLlmProvider(event.target.value))}>
                <option value="groq">Groq (free)</option>
                <option value="openai">OpenAI</option>
                <option value="openai_compatible">Other OpenAI-compatible</option>
              </select>
            </label>
            <label className="settings-field"><span>{llmProvider === "groq" ? "Groq API key" : "LLM API key"}</span><input type="password" value={llmKey} onChange={(event) => setLlmKey(event.target.value)} placeholder={isRecord(configuration?.llm) && configuration.llm.has_api_key ? "Saved securely; leave blank to keep" : llmProvider === "groq" ? "Paste your Groq API key" : "Paste your LLM API key"} autoComplete="new-password" /></label>
            <label className="settings-field"><span>Model</span><input value={llmModel} onChange={(event) => setLlmModel(event.target.value)} maxLength={200} required /></label>
            <label className="settings-field"><span>Chat completions URL</span><input type="url" value={llmBaseUrl} onChange={(event) => setLlmBaseUrl(event.target.value)} required /></label>
            <small>{isRecord(configuration?.llm) && configuration.llm.configured ? "API key saved securely. It is used only for low-confidence transactions." : "Uncertain transaction descriptions, vendor, amount, and currency will be sent to the selected provider for a category suggestion."}</small>
            <button type="button" className="button button-secondary button-small" disabled={savingProvider || testingProvider !== ""} onClick={() => void testProvider("llm")}>{testingProvider === "llm" ? "Testing…" : "Test LLM API key"}</button>
            {isRecord(configuration?.llm) && configuration.llm.has_api_key === true && <button type="button" className="auth-toggle" disabled={savingProvider} onClick={() => void clearProvider("clear_llm")}>Remove saved LLM credentials</button>}
          </div>
          <button className="button button-primary" type="submit" disabled={savingProvider}>{savingProvider ? "Saving securely…" : "Save provider settings"}</button>
        </form>
      </section>
      <section className="panel integration-instructions">
        <div className="panel-heading"><div className="panel-title-group"><span className="heading-icon settings-heading-icon"><Icon name="settings" size={17} /></span><div><h2>Configure integrations</h2><p>Set provider credentials in the backend environment, then restart the API.</p></div></div></div>
        <ul>
          <li><strong>Hindsight:</strong> a separate memory bank is created for each business workspace.</li>
          <li><strong>Database:</strong> hosted deployments should use PostgreSQL and run Alembic migrations before starting the API.</li>
          <li><strong>LLM:</strong> default is Groq. Set <code>LLM_PROVIDER=groq</code>, <code>LLM_API_KEY</code>, and optionally <code>LLM_MODEL</code> or <code>LLM_BASE_URL</code>. Low-confidence transaction fields are sent to the selected provider; the API key remains server-side.</li>
          <li><strong>Security:</strong> set <code>AUTH_REQUIRED=true</code>, a unique <code>AUTH_SECRET</code>, and <code>UPLOAD_ENCRYPTION_KEY</code>. Never place service credentials in frontend environment variables.</li>
          <li><strong>OCR:</strong> install the Python packages and system binaries in the backend image. Never place provider credentials in frontend environment variables.</li>
        </ul>
      </section>
    </>}
    <div className="security-note"><Icon name="shield" size={17} /><span><strong>Credentials stay server-side.</strong><small>This page displays readiness only. Configure secrets through your deployment environment or secret manager.</small></span></div>
  </div>;
}

function IntegrationCard({ integration }: { integration: ApiRecord }) {
  const configured = integration.configured === true || integration.ready === true;
  const status = displayValue(integration.status, configured ? "Configured" : "Needs configuration");
  return <article className="panel integration-card">
    <div className="integration-card-top"><span className="integration-mark"><Icon name={integration.name?.toString().toLowerCase().includes("whatsapp") ? "message" : integration.name?.toString().toLowerCase().includes("database") ? "file" : "settings"} size={18} /></span><span className={`live-pill ${configured ? "" : "offline-pill"}`}><span />{status.toUpperCase()}</span></div>
    <h2>{displayValue(integration.name, "Service")}</h2>
    <p>{displayValue(integration.description, "Configuration is managed on the backend.")}</p>
    {typeof integration.mode === "string" && <small className="integration-mode">Mode: {integration.mode}</small>}
  </article>;
}
