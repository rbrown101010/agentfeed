import { httpRouter } from "convex/server";
import { env, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildPrompt, buildSkillDoc } from "./prompt";

const http = httpRouter();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Feed-Key",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function randomKey(prefix: string): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

function siteUrlFrom(request: Request): string {
  return env.CONVEX_SITE_URL ?? new URL(request.url).origin;
}

async function agentAccount(ctx: any, request: Request) {
  const key =
    request.headers.get("X-Feed-Key") ??
    new URL(request.url).searchParams.get("key");
  if (!key) return null;
  return await ctx.runQuery(internal.accounts.byWriteKeyInternal, { writeKey: key });
}

// ---------- App endpoints (called by the web client) ----------

// One-tap account creation. Returns everything onboarding needs.
http.route({
  path: "/app/bootstrap",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = randomKey("feedsecret");
    const writeKey = randomKey("feedkey");
    await ctx.runMutation(internal.accounts.create, { secret, writeKey });
    const siteUrl = siteUrlFrom(request);
    return json({
      secret,
      write_key: writeKey,
      push_url: `${siteUrl}/agent/push`,
      skill_url: `${siteUrl}/agent/skill`,
      context_url: `${siteUrl}/agent/context`,
      prompt: buildPrompt(siteUrl, writeKey),
    });
  }),
});

// Pull-to-refresh: fire the user's Grokbot routine webhook.
http.route({
  path: "/app/refresh",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Body must be JSON" }, 400);
    }
    const account = await ctx.runQuery(internal.accounts.bySecretInternal, {
      secret: String(body?.secret ?? ""),
    });
    if (account === null) return json({ error: "Unknown account" }, 401);
    if (!account.grokWebhookUrl) {
      return json({ ok: false, error: "No agent webhook configured" }, 409);
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (account.grokWebhookKey) {
      headers[account.grokWebhookHeader || "X-Api-Key"] = account.grokWebhookKey;
    }
    try {
      const res = await fetch(account.grokWebhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ reason: "user_pulled_to_refresh" }),
        signal: AbortSignal.timeout(10000),
      });
      await ctx.runMutation(internal.accounts.touchRefresh, { accountId: account._id });
      return json({ ok: res.ok, status: res.status });
    } catch (e: any) {
      return json({ ok: false, error: String(e?.message ?? e) }, 502);
    }
  }),
});

// ---------- Agent endpoints (called by Grokbot & friends) ----------

// The skill doc: everything an agent needs to be a good feed editor.
http.route({
  path: "/agent/skill",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const account = await agentAccount(ctx, request);
    if (account === null) return json({ error: "Missing or invalid X-Feed-Key" }, 401);
    return new Response(buildSkillDoc(siteUrlFrom(request)), {
      status: 200,
      headers: { "Content-Type": "text/markdown; charset=utf-8", ...CORS },
    });
  }),
});

// What the human saw/dismissed — the agent reads this before pushing.
http.route({
  path: "/agent/context",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const account = await agentAccount(ctx, request);
    if (account === null) return json({ error: "Missing or invalid X-Feed-Key" }, 401);
    const cards = await ctx.runQuery(internal.cards.contextForAgent, {
      accountId: account._id,
    });
    const replies = await ctx.runMutation(internal.cards.repliesForAgent, {
      accountId: account._id,
    });
    return json({ replies, cards });
  }),
});

// The write path: ranked cards in.
http.route({
  path: "/agent/push",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const account = await agentAccount(ctx, request);
    if (account === null) return json({ error: "Missing or invalid X-Feed-Key" }, 401);
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Body must be JSON" }, 400);
    }
    const rawCards = Array.isArray(body?.cards) ? body.cards : null;
    if (rawCards === null) return json({ error: "Body must have a cards array" }, 400);
    if (rawCards.length > 100) return json({ error: "Max 100 cards per push" }, 400);

    const errors: string[] = [];
    const cards = rawCards.flatMap((raw: any, i: number) => {
      const cardKey = String(raw?.id ?? raw?.card_key ?? raw?.cardKey ?? "").trim();
      const title = String(raw?.title ?? "").trim();
      const rank = Number(raw?.rank ?? raw?.score);
      if (!cardKey || !title || !Number.isFinite(rank)) {
        errors.push(`cards[${i}]: id, title, and numeric rank are required`);
        return [];
      }
      const str = (x: unknown) => (typeof x === "string" && x.trim() !== "" ? x : undefined);
      const slides = (Array.isArray(raw?.slides) ? raw.slides : [])
        .slice(0, 10)
        .map((s: any) => ({
          title: str(s?.title),
          body: str(s?.body ?? s?.text),
          imageUrl: str(s?.image_url ?? s?.imageUrl),
          deepLink: str(s?.deep_link ?? s?.deepLink ?? s?.url),
        }))
        .filter((s: any) => s.title || s.body || s.imageUrl);
      return [{
        cardKey,
        rank,
        source: (str(raw?.source) ?? "agent").toLowerCase().slice(0, 24),
        title: title.slice(0, 200),
        summary: str(raw?.summary ?? raw?.body ?? raw?.preview),
        slides,
        deepLink: str(raw?.deep_link ?? raw?.deepLink ?? raw?.url),
        replyPrompt: str(raw?.reply_placeholder ?? raw?.replyPlaceholder ?? raw?.reply_prompt ?? raw?.ask)?.slice(0, 140),
      }];
    });
    if (cards.length === 0) {
      return json({ error: "No valid cards", details: errors }, 400);
    }
    const result = await ctx.runMutation(internal.cards.upsertBatch, {
      accountId: account._id,
      pushedBy: String(body?.pushed_by ?? body?.pushedBy ?? "agent").slice(0, 60),
      replace: body?.replace === true,
      cards,
    });
    return json({ ok: true, ...result, warnings: errors });
  }),
});

// CORS preflight for browser calls.
for (const path of ["/app/bootstrap", "/app/refresh"]) {
  http.route({
    path,
    method: "OPTIONS",
    handler: httpAction(async () => new Response(null, { status: 204, headers: CORS })),
  });
}

export default http;
