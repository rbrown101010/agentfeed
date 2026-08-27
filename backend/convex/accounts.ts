import { v } from "convex/values";
import { env, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { buildPrompt } from "./prompt";
import type { QueryCtx } from "./_generated/server";

export async function accountBySecret(ctx: QueryCtx, secret: string) {
  const account = await ctx.db
    .query("accounts")
    .withIndex("by_secret", (q) => q.eq("secret", secret))
    .unique();
  if (account === null) throw new Error("Unknown account");
  return account;
}

export const create = internalMutation({
  args: {
    secret: v.string(),
    writeKey: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.id("accounts"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("accounts", {
      secret: args.secret,
      writeKey: args.writeKey,
      name: args.name,
    });
  },
});

export const me = query({
  args: { secret: v.string() },
  returns: v.object({
    name: v.optional(v.string()),
    writeKey: v.string(),
    hasWebhook: v.boolean(),
    grokWebhookUrl: v.optional(v.string()),
    grokWebhookKey: v.optional(v.string()),
    grokWebhookHeader: v.optional(v.string()),
    lastPushAt: v.optional(v.number()),
    lastRefreshRequestAt: v.optional(v.number()),
  }),
  handler: async (ctx, { secret }) => {
    const a = await accountBySecret(ctx, secret);
    return {
      name: a.name,
      writeKey: a.writeKey,
      hasWebhook: a.grokWebhookUrl !== undefined && a.grokWebhookUrl !== "",
      grokWebhookUrl: a.grokWebhookUrl,
      grokWebhookKey: a.grokWebhookKey,
      grokWebhookHeader: a.grokWebhookHeader,
      lastPushAt: a.lastPushAt,
      lastRefreshRequestAt: a.lastRefreshRequestAt,
    };
  },
});

export const setGrokWebhook = mutation({
  args: {
    secret: v.string(),
    url: v.string(),
    key: v.optional(v.string()),
    header: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { secret, url, key, header }) => {
    const a = await accountBySecret(ctx, secret);
    if (url !== "" && !url.startsWith("https://")) {
      throw new Error("Webhook URL must start with https://");
    }
    await ctx.db.patch(a._id, {
      grokWebhookUrl: url,
      grokWebhookKey: key,
      grokWebhookHeader: header,
    });
    return null;
  },
});

export const touchRefresh = internalMutation({
  args: { accountId: v.id("accounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }) => {
    await ctx.db.patch(accountId, { lastRefreshRequestAt: Date.now() });
    return null;
  },
});

export const byWriteKeyInternal = internalQuery({
  args: { writeKey: v.string() },
  returns: v.any(),
  handler: async (ctx, { writeKey }) => {
    return await ctx.db
      .query("accounts")
      .withIndex("by_writeKey", (q) => q.eq("writeKey", writeKey))
      .unique();
  },
});

export const bySecretInternal = internalQuery({
  args: { secret: v.string() },
  returns: v.any(),
  handler: async (ctx, { secret }) => {
    return await ctx.db
      .query("accounts")
      .withIndex("by_secret", (q) => q.eq("secret", secret))
      .unique();
  },
});

// Lets the web app re-display the paste-into-your-agent prompt any time.
export const onboarding = query({
  args: { secret: v.string() },
  returns: v.object({
    prompt: v.string(),
    pushUrl: v.string(),
    writeKey: v.string(),
  }),
  handler: async (ctx, { secret }) => {
    const a = await accountBySecret(ctx, secret);
    const siteUrl = env.CONVEX_SITE_URL ?? "";
    return {
      prompt: buildPrompt(siteUrl, a.writeKey),
      pushUrl: `${siteUrl}/agent/push`,
      writeKey: a.writeKey,
    };
  },
});
