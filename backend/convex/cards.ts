import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { slideValidator } from "./schema";
import { accountBySecret } from "./accounts";

const MAX_FEED = 200;
const MAX_ACTIVE_SWEEP = 500;

export const incomingCardValidator = v.object({
  cardKey: v.string(),
  rank: v.number(),
  source: v.string(),
  title: v.string(),
  summary: v.optional(v.string()),
  slides: v.array(slideValidator),
  deepLink: v.optional(v.string()),
  replyPrompt: v.optional(v.string()),
});

const cardShape = v.object({
  _id: v.id("cards"),
  _creationTime: v.number(),
  accountId: v.id("accounts"),
  cardKey: v.string(),
  rank: v.number(),
  source: v.string(),
  title: v.string(),
  summary: v.optional(v.string()),
  slides: v.array(slideValidator),
  deepLink: v.optional(v.string()),
  replyPrompt: v.optional(v.string()),
  pushedBy: v.string(),
  pushedAt: v.number(),
  seen: v.boolean(),
  seenAt: v.optional(v.number()),
  dismissed: v.boolean(),
  dismissedAt: v.optional(v.number()),
  lastReply: v.union(v.object({ text: v.string(), at: v.number() }), v.null()),
});

// The feed the client scrolls: active cards, agent-set rank order.
export const feed = query({
  args: { secret: v.string() },
  returns: v.array(cardShape),
  handler: async (ctx, { secret }) => {
    const account = await accountBySecret(ctx, secret);
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_account_active", (q) =>
        q.eq("accountId", account._id).eq("dismissed", false),
      )
      .order("asc")
      .take(MAX_FEED);
    const lastReplies = await Promise.all(
      cards.map((c) =>
        ctx.db
          .query("replies")
          .withIndex("by_card", (q) => q.eq("cardId", c._id))
          .order("desc")
          .first(),
      ),
    );
    return cards.map((c, i) => ({
      ...c,
      lastReply: lastReplies[i]
        ? { text: lastReplies[i]!.text, at: lastReplies[i]!._creationTime }
        : null,
    }));
  },
});

export const markSeen = mutation({
  args: { secret: v.string(), cardId: v.id("cards") },
  returns: v.null(),
  handler: async (ctx, { secret, cardId }) => {
    const account = await accountBySecret(ctx, secret);
    const card = await ctx.db.get(cardId);
    if (card === null || card.accountId !== account._id) throw new Error("Not your card");
    if (!card.seen) await ctx.db.patch(cardId, { seen: true, seenAt: Date.now() });
    return null;
  },
});

export const dismiss = mutation({
  args: { secret: v.string(), cardId: v.id("cards") },
  returns: v.null(),
  handler: async (ctx, { secret, cardId }) => {
    const account = await accountBySecret(ctx, secret);
    const card = await ctx.db.get(cardId);
    if (card === null || card.accountId !== account._id) throw new Error("Not your card");
    await ctx.db.patch(cardId, { dismissed: true, dismissedAt: Date.now() });
    return null;
  },
});

// Agents push here (via http.ts). Upsert by cardKey; dismissed cards never resurrect.
export const upsertBatch = internalMutation({
  args: {
    accountId: v.id("accounts"),
    pushedBy: v.string(),
    replace: v.boolean(),
    cards: v.array(incomingCardValidator),
  },
  returns: v.object({ received: v.number(), feedSize: v.number() }),
  handler: async (ctx, { accountId, pushedBy, replace, cards }) => {
    const now = Date.now();
    const pushedKeys = new Set<string>();
    for (const card of cards) {
      pushedKeys.add(card.cardKey);
      const existing = await ctx.db
        .query("cards")
        .withIndex("by_account_card", (q) =>
          q.eq("accountId", accountId).eq("cardKey", card.cardKey),
        )
        .unique();
      if (existing === null) {
        await ctx.db.insert("cards", {
          accountId,
          ...card,
          pushedBy,
          pushedAt: now,
          seen: false,
          dismissed: false,
        });
      } else if (!existing.dismissed) {
        await ctx.db.patch(existing._id, { ...card, pushedBy, pushedAt: now });
      }
      // dismissed cards stay dismissed — the user said done.
    }
    if (replace) {
      // The agent is curating the whole feed: anything active it didn't
      // re-push this run rotates out.
      const active = await ctx.db
        .query("cards")
        .withIndex("by_account_active", (q) =>
          q.eq("accountId", accountId).eq("dismissed", false),
        )
        .take(MAX_ACTIVE_SWEEP);
      for (const card of active) {
        if (!pushedKeys.has(card.cardKey)) {
          await ctx.db.patch(card._id, { dismissed: true, dismissedAt: now });
        }
      }
    }
    await ctx.db.patch(accountId, { lastPushAt: now });
    const feedSize = (
      await ctx.db
        .query("cards")
        .withIndex("by_account_active", (q) =>
          q.eq("accountId", accountId).eq("dismissed", false),
        )
        .take(MAX_ACTIVE_SWEEP)
    ).length;
    return { received: cards.length, feedSize };
  },
});

// What the agent reads back before a run: current feed + what happened to it.
export const contextForAgent = internalQuery({
  args: { accountId: v.id("accounts") },
  returns: v.any(),
  handler: async (ctx, { accountId }) => {
    const recent = await ctx.db
      .query("cards")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .order("desc")
      .take(300);
    return recent.map((c) => ({
      id: c.cardKey,
      rank: c.rank,
      source: c.source,
      title: c.title,
      pushed_by: c.pushedBy,
      pushed_at: c.pushedAt,
      seen: c.seen,
      dismissed: c.dismissed,
      dismissed_at: c.dismissedAt ?? null,
    }));
  },
});

// User typed a response on a card: store it, then wake the agent.
export const reply = mutation({
  args: { secret: v.string(), cardId: v.id("cards"), text: v.string() },
  returns: v.null(),
  handler: async (ctx, { secret, cardId, text }) => {
    const account = await accountBySecret(ctx, secret);
    const card = await ctx.db.get(cardId);
    if (card === null || card.accountId !== account._id) throw new Error("Not your card");
    const trimmed = text.trim().slice(0, 2000);
    if (trimmed === "") throw new Error("Empty reply");
    await ctx.db.insert("replies", {
      accountId: account._id,
      cardId,
      cardKey: card.cardKey,
      cardTitle: card.title,
      text: trimmed,
    });
    if (!card.seen) await ctx.db.patch(cardId, { seen: true, seenAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.notify.replyWebhook, {
      accountId: account._id,
      cardKey: card.cardKey,
      cardTitle: card.title,
      text: trimmed,
    });
    return null;
  },
});

// Replies for the agent, newest first. Marks them delivered so the agent
// can tell new ones from ones it already handled.
export const repliesForAgent = internalMutation({
  args: { accountId: v.id("accounts") },
  returns: v.any(),
  handler: async (ctx, { accountId }) => {
    const recent = await ctx.db
      .query("replies")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .order("desc")
      .take(100);
    const now = Date.now();
    const out = [];
    for (const r of recent) {
      out.push({
        card_id: r.cardKey,
        card_title: r.cardTitle,
        reply: r.text,
        replied_at: r._creationTime,
        new: r.deliveredAt === undefined,
      });
      if (r.deliveredAt === undefined) await ctx.db.patch(r._id, { deliveredAt: now });
    }
    return out;
  },
});
