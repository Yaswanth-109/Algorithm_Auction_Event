"use client";

import { FormEvent, useEffect, useState } from "react";
import { getApiBase } from "./lib/api";

type User = { id: string; email: string; role: "ADMIN" | "TEAM"; teamId: string | null };
const api = getApiBase();

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    fetch(`${api}/api/auth/session`, { credentials: "include" })
      .then(async (response) => response.ok ? (await response.json()).user as User : null)
      .then(setUser)
      .catch(() => setMessage("Could not connect to the service. Check that the API is running."))
      .finally(() => setBusy(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch(`${api}/api/auth/login`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Sign in failed");
      setUser(payload.user); setPassword("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Sign in failed"); }
    finally { setBusy(false); }
  }

  async function signOut() {
    await fetch(`${api}/api/auth/logout`, { method: "POST", credentials: "include" });
    setUser(null); setMessage("You are signed out.");
  }

  return <main className="shell">
    <nav className="topbar"><a className="brand" href="/" aria-label="Algorithm Auction home"><span className="brand-mark">A</span> ALGORITHM <b>AUCTION</b></a><span className="event-label"><i /> EVENT PLATFORM</span></nav>
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><span /> COMPETITION STARTS WITH A SMART MOVE</div>
        <h1>Bid smart.<br /><em>Crack the code.</em></h1>
        <p className="intro">A 90-minute strategy and programming arena. Each two-person team starts with 1,000 credits, bids in two auctions, then tackles two algorithms in Python, Java, C, or C++.</p>
        <div className="stats"><div><strong>90 <small>MIN</small></strong><span>EVENT DURATION</span></div><div><strong>1,000</strong><span>STARTING CREDITS</span></div><div><strong>20 <small>MIN</small></strong><span>PER ALGORITHM</span></div></div>
      </div>
      <div className="auth-card">
        <div className="card-topline"><span>SECURE ACCESS</span><a className="led-card-link" href="/led?page=published">LED DISPLAY ↗</a></div>
        {user ? <>
          <div className="welcome-icon">✓</div><p className="kicker">SESSION ACTIVE</p><h2>Welcome back.</h2>
          <p className="muted">Signed in as <b>{user.email}</b></p>
          <div className="role-pill">{user.role === "ADMIN" ? "EVENT ADMINISTRATOR" : `TEAM MEMBER${user.teamId ? ` · ${user.teamId.slice(0, 8)}` : ""}`}</div>
          <p className="notice">Your account is authenticated. Event dashboards become available as event administration and auction phases are enabled.</p>
          <a className="primary-button dashboard-entry" href={user.role === "ADMIN" ? "/admin" : "/dashboard"}>{user.role === "ADMIN" ? "OPEN ADMIN CONSOLE" : "OPEN TEAM DASHBOARD"}<span>↗</span></a>
          <button className="secondary-button" onClick={signOut}>SIGN OUT <span>↗</span></button>
        </> : <>
          <p className="kicker">YOUR EVENT, IN SYNC</p><h2>Enter the arena.</h2>
          <p className="muted">Sign in with your team or administrator account.</p>
          <form onSubmit={submit}>
            <label htmlFor="email">EMAIL ADDRESS</label><input id="email" type="email" autoComplete="username" required maxLength={254} placeholder="you@yourteam.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="password">PASSWORD</label><input id="password" type="password" autoComplete="current-password" required maxLength={256} placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {message && <div className="form-message" role="alert">{message}</div>}
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "PLEASE WAIT…" : "SIGN IN TO YOUR TEAM"}<span>↗</span></button>
          </form>
          <div className="secure-note"><span>◈</span> Secure team access <i /> Same team, shared progress</div>
        </>}
      </div>
    </section>
    <footer><span>ALGORITHM AUCTION <i>© 2026</i></span><span>BUILT FOR THE NEXT MOVE <b>◆</b></span></footer>
  </main>;
}
