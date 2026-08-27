export const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string;
// HTTP endpoints live on .convex.site (same deployment, different host)
export const SITE_URL = CONVEX_URL.replace(".convex.cloud", ".convex.site");

const SECRET_KEY = "agentfeed_secret";

// Canonical public URL (set at build time); falls back to wherever we run.
export const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined) ?? window.location.origin;

// A transfer link (#s=<secret>) carries an account to a new device/origin.
// Consumed once and stripped from the URL/history immediately.
function consumeTransferLink(): string | null {
  const m = window.location.hash.match(/^#s=([A-Za-z0-9_]+)$/);
  if (!m) return null;
  history.replaceState(null, "", window.location.pathname);
  return m[1];
}

export function loadSecret(): string | null {
  const transferred = consumeTransferLink();
  if (transferred) {
    saveSecret(transferred);
    return transferred;
  }
  try {
    return localStorage.getItem(SECRET_KEY);
  } catch {
    return null;
  }
}
export function saveSecret(secret: string) {
  try {
    localStorage.setItem(SECRET_KEY, secret);
  } catch {}
}
export function clearSecret() {
  try {
    localStorage.removeItem(SECRET_KEY);
  } catch {}
}

// Accepts a full transfer link, a bare "#s=..." fragment, or a raw key.
export function extractSecret(input: string): string | null {
  const trimmed = input.trim();
  const fromLink = trimmed.match(/#s=([A-Za-z0-9_]+)/);
  if (fromLink) return fromLink[1];
  if (/^feedsecret_[a-f0-9]+$/.test(trimmed)) return trimmed;
  return null;
}

export type BootstrapResult = {
  secret: string;
  write_key: string;
  push_url: string;
  prompt: string;
};

export async function bootstrap(): Promise<BootstrapResult> {
  const res = await fetch(`${SITE_URL}/app/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`Bootstrap failed (${res.status})`);
  return await res.json();
}

export async function requestRefresh(secret: string): Promise<{ ok: boolean; error?: string; status?: number }> {
  const res = await fetch(`${SITE_URL}/app/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret }),
  });
  return await res.json();
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// per-source card art
export const SOURCE_STYLE: Record<string, { grad: [string, string]; emoji: string }> = {
  slack:    { grad: ["#2e1437", "#611f69"], emoji: "💬" },
  notion:   { grad: ["#191919", "#3d3a34"], emoji: "📄" },
  clickup:  { grad: ["#3b1f5e", "#7b68ee"], emoji: "✅" },
  email:    { grad: ["#0f2745", "#1a56db"], emoji: "✉️" },
  calendar: { grad: ["#0c3d3a", "#0f766e"], emoji: "📅" },
  x:        { grad: ["#0a0f1a", "#1d3a5f"], emoji: "𝕏" },
  github:   { grad: ["#161b22", "#2d333b"], emoji: "🐙" },
  news:     { grad: ["#431407", "#c2410c"], emoji: "📰" },
  agent:    { grad: ["#052e1c", "#15803d"], emoji: "🤖" },
};
export const DEFAULT_STYLE = { grad: ["#1e1b4b", "#4338ca"] as [string, string], emoji: "⚡" };

export function sourceStyle(source: string) {
  return SOURCE_STYLE[source] ?? DEFAULT_STYLE;
}
