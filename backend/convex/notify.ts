import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

export const getAccount = internalQuery({
  args: { accountId: v.id("accounts") },
  returns: v.any(),
  handler: async (ctx, { accountId }) => {
    return await ctx.db.get(accountId);
  },
});

// Wake the user's agent: POST the reply to their Grokbot routine webhook.
export const replyWebhook = internalAction({
  args: {
    accountId: v.id("accounts"),
    cardKey: v.string(),
    cardTitle: v.string(),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { accountId, cardKey, cardTitle, text }) => {
    const account = await ctx.runQuery(internal.notify.getAccount, { accountId });
    if (!account?.grokWebhookUrl) {
      console.log("reply saved; no agent webhook configured — agent sees it next run");
      return null;
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (account.grokWebhookKey) {
      headers[account.grokWebhookHeader || "X-Api-Key"] = account.grokWebhookKey;
    }
    try {
      const res = await fetch(account.grokWebhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          reason: "user_replied",
          card_id: cardKey,
          card_title: cardTitle,
          reply: text,
        }),
        signal: AbortSignal.timeout(10000),
      });
      console.log(`reply webhook fired: ${res.status}`);
    } catch (e: any) {
      console.log(`reply webhook failed: ${String(e?.message ?? e)}`);
    }
    return null;
  },
});
