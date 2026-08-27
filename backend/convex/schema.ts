import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const slideValidator = v.object({
  title: v.optional(v.string()),
  body: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  deepLink: v.optional(v.string()),
});

export default defineSchema({
  accounts: defineTable({
    name: v.optional(v.string()),
    // credential the web/iOS client holds
    secret: v.string(),
    // credential agents hold (lives in the Grokbot prompt)
    writeKey: v.string(),
    // outbound trigger: the webhook Grokbot shows after saving the routine
    grokWebhookUrl: v.optional(v.string()),
    grokWebhookKey: v.optional(v.string()),
    grokWebhookHeader: v.optional(v.string()),
    lastRefreshRequestAt: v.optional(v.number()),
    lastPushAt: v.optional(v.number()),
  })
    .index("by_secret", ["secret"])
    .index("by_writeKey", ["writeKey"]),

  cards: defineTable({
    accountId: v.id("accounts"),
    // agent-supplied stable key so re-pushes upsert instead of duplicate
    cardKey: v.string(),
    rank: v.number(),
    source: v.string(),
    title: v.string(),
    summary: v.optional(v.string()),
    slides: v.array(slideValidator),
    deepLink: v.optional(v.string()),
    // agent-authored: when set, the card shows a response box with this placeholder
    replyPrompt: v.optional(v.string()),
    pushedBy: v.string(),
    pushedAt: v.number(),
    seen: v.boolean(),
    seenAt: v.optional(v.number()),
    dismissed: v.boolean(),
    dismissedAt: v.optional(v.number()),
  })
    .index("by_account", ["accountId"])
    .index("by_account_card", ["accountId", "cardKey"])
    .index("by_account_active", ["accountId", "dismissed", "rank"]),

  // What the user typed back on a card. The agent reads these via
  // /agent/context and gets woken by the outbound webhook when one lands.
  replies: defineTable({
    accountId: v.id("accounts"),
    cardId: v.id("cards"),
    cardKey: v.string(),
    cardTitle: v.string(),
    text: v.string(),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_account", ["accountId"])
    .index("by_card", ["cardId"]),
});
