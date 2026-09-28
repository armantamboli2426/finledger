"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Brand } from "./Brand";
import { Icon } from "./Icons";
import { apiRequest, getBusinessId, isRecord, persistAuthToken, persistBusinessId } from "@/lib/api";

const navigation = [
  { label: "Overview", href: "/", icon: "grid" },
  { label: "Upload", href: "/upload", icon: "upload" },
  { label: "Statements", href: "/statements", icon: "file" },
  { label: "Transactions", href: "/transactions", icon: "swap" },
  { label: "Memory", href: "/memory", icon: "file" },
  { label: "Exports", href: "/exports", icon: "download" }
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authState, setAuthState] = useState<"checking" | "open" | "signedOut" | "signedIn" | "error">("checking");
  const [registering, setRegistering] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const currentTitle = navigation.find((item) => item.href === pathname)?.label ?? (pathname.startsWith("/statements/") ? "Statement detail" : "Settings");

  async function loadSession() {
    setAuthState("checking");
    setAuthError("");
    try {
      const data: unknown = await apiRequest("/api/auth/session");
      if (!isRecord(data)) throw new Error("The API returned an invalid session response.");
      if (data.authenticated === true) {
        const businesses = Array.isArray(data.businesses) ? data.businesses.filter(isRecord) : [];
        const active = businesses.find((item) => item.id === getBusinessId()) ?? businesses[0];
        if (typeof active?.id === "string") persistBusinessId(active.id);
        setAuthState("signedIn");
      } else {
        setAuthState(data.auth_required === true ? "signedOut" : "open");
      }
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : "Could not verify the current session.");
      setAuthState("error");
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      const body = registering
        ? { email, password, phone, business_name: businessName }
        : { email, password };
      const data: unknown = await apiRequest(registering ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify(body)
      });
      if (!isRecord(data) || !Array.isArray(data.businesses)) throw new Error("The API returned an invalid sign-in response.");
      if (typeof data.token === "string") persistAuthToken(data.token);
      const firstBusiness = data.businesses.find(isRecord);
      if (typeof firstBusiness?.id === "string") persistBusinessId(firstBusiness.id);
      setAuthState("signedIn");
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : "Sign in could not be completed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
      persistAuthToken("");
      setAuthState("signedOut");
      setPassword("");
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : "Sign out could not be completed.");
    }
  }

  if (authState !== "open" && authState !== "signedIn") {
    return <main className="auth-screen">
      <section className="panel auth-card">
        <Brand />
        {authState === "checking" && <><h1>Checking your workspace…</h1><p>Your session is being verified with FINLEDGER.</p></>}
        {authState === "error" && <><h1>FINLEDGER is unavailable</h1><p>{authError}</p><button className="button button-primary" onClick={() => void loadSession()}>Try again</button></>}
        {authState === "signedOut" && <>
          <div className="eyebrow"><span className="eyebrow-line" /> PRIVATE BUSINESS WORKSPACE</div>
          <h1>{registering ? "Create your workspace" : "Welcome back"}</h1>
          <p>{registering ? "Create an owner account and a private business workspace." : "Sign in to access your business books."}</p>
          <form className="auth-form" onSubmit={submitAuth}>
            <label className="settings-field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={320} /></label>
            <label className="settings-field"><span>Password</span><input type="password" autoComplete={registering ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={registering ? 12 : 1} maxLength={128} /></label>
            {registering && <>
              <label className="settings-field"><span>Phone number</span><input type="tel" autoComplete="tel" placeholder="9876543210" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 10))} required pattern="[6-9][0-9]{9}" title="Enter 10 digit mobile number" maxLength={10} /></label>
              <label className="settings-field"><span>Business name</span><input value={businessName} onChange={(event) => setBusinessName(event.target.value)} required minLength={2} maxLength={200} /></label>
            </>}
            {authError && <div className="form-error" role="alert">{authError}</div>}
            <button className="button button-primary auth-submit" type="submit" disabled={authBusy}>{authBusy ? "Please wait…" : registering ? "Create account" : "Sign in"}</button>
          </form>
          <button className="auth-toggle" onClick={() => { setRegistering(!registering); setAuthError(""); }}>{registering ? "Already have an account? Sign in" : "New here? Create a workspace"}</button>
        </>}
      </section>
    </main>;
  }

  return <div className="app-frame">
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
      <Link className="brand-link" href="/" onClick={() => setMobileOpen(false)}><Brand /></Link>
      <div className="workspace-switcher"><span className="workspace-avatar">•</span><span className="workspace-copy"><strong>Your business</strong><small>Workspace</small></span><span className="workspace-caret">⌄</span></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav className="main-nav" aria-label="Main navigation">
        {navigation.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return <Link className={`nav-item ${active ? "nav-active" : ""}`} href={item.href} key={item.href} onClick={() => setMobileOpen(false)}><Icon name={item.icon} size={18} /><span>{item.label}</span></Link>;
        })}
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-tip"><div className="tip-spark"><Icon name="file" size={16} /></div><strong>Books that learn.</strong><p>Every correction makes your next close a little easier.</p><Link href="/memory">Explore memory <Icon name="arrow" size={13} /></Link></div>
      <Link className={`nav-item settings-link ${pathname === "/settings" ? "nav-active" : ""}`} href="/settings"><Icon name="settings" size={18} /><span>Settings</span></Link>
      <div className="sidebar-profile"><span className="profile-avatar">•</span><span><strong>Workspace owner</strong><small>Account</small></span>{authState === "signedIn" && <button className="profile-more" onClick={() => void signOut()} aria-label="Sign out">Sign out</button>}</div>
    </aside>
    <div className="main-column">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Icon name="menu" size={20} /></button>
        <div className="breadcrumb">Workspace <span>/</span> <strong>{currentTitle}</strong></div>
        <div className="topbar-right"><span className="period-label">Your workspace</span><span className="header-avatar" aria-hidden="true">•</span></div>
      </header>
      <main className="page-content">{children}</main>
      <footer className="page-footer"><span>Made for the people behind the numbers.</span><span>FINLEDGER <i>·</i> Your business, your books</span></footer>
    </div>
  </div>;
}
