// The onboarding prompt the user pastes into their agent (Grokbot, Cursor,
// anything that can run a scheduled routine and make HTTP calls), plus the
// full skill doc served at /agent/skill. Server-side so we can improve the
// skill without shipping a new client.

export function buildPrompt(siteUrl: string, writeKey: string): string {
  return `You are my feed agent. You maintain the feed inside my AgentFeed app — a TikTok-style scroll of everything I actually need to know. Run this routine now, then keep my feed fresh every time it runs (schedule: 2x per day).

Each run, do exactly this:
1. GET ${siteUrl}/agent/skill with header "X-Feed-Key: ${writeKey}" and follow those instructions — they define the card format and rules.
2. GET ${siteUrl}/agent/context with the same header to see what I already saw or dismissed.
3. If the trigger payload or context contains a new reply from me, handle that FIRST — it is a direct instruction about that card, and you must answer by re-pushing that card with a response slide.
4. Go through everything you are connected to (email, calendar, Slack, Notion, ClickUp, X, news, your own memory of what I care about) and choose the 10–20 most important things for me right now, ranked. Rank 1 = the single most important.
5. POST them to ${siteUrl}/agent/push with header "X-Feed-Key: ${writeKey}" and body {"replace": true, "pushed_by": "<your name>", "cards": [...]}.

Rules: rank ruthlessly — this is a feed, not an archive. Never re-push a card id I dismissed. Use multiple slides for rich items. Always include a deep_link back to the real thing when one exists. Confirm each run with a one-line summary of what you pushed.`;
}

export function buildSkillDoc(siteUrl: string): string {
  return `# AgentFeed skill

You maintain a ranked feed that a human scrolls like TikTok. You are the editor. The app is a dumb player: it shows active cards sorted by your \`rank\` (ascending — rank 1 is shown first).

Authenticate every request with the header:

    X-Feed-Key: <the key you were given>

## Endpoints

- \`GET ${siteUrl}/agent/context\` — recent cards with their state: \`seen\`, \`dismissed\`. Read this BEFORE pushing.
- \`POST ${siteUrl}/agent/push\` — push a batch of ranked cards (max 100 per push).

## Push body

\`\`\`json
{
  "pushed_by": "grokbot",
  "replace": true,
  "cards": [
    {
      "id": "slack-thread-C042-1724712345",
      "rank": 1,
      "source": "slack",
      "title": "Design review thread needs your reply",
      "summary": "Sarah asked twice about the onboarding flow mock.",
      "deep_link": "https://app.slack.com/client/T01/C042/p1724712345",
      "slides": [
        { "title": "The ask", "body": "Sarah: 'Can you confirm the v2 mock is final by EOD?'" },
        { "title": "Context", "body": "Thread has 14 replies. Design freeze is Friday." }
      ]
    }
  ]
}
\`\`\`

## Field rules

- \`id\` (string, required): a stable key for the underlying thing (thread ts, doc id, email message-id). Re-pushing the same id UPDATES the card instead of duplicating it. Never reuse an id for a different thing.
- \`rank\` (number, required): 1 = most important. The feed is sorted by this.
- \`source\` (string, required): lowercase origin — one of \`slack\`, \`notion\`, \`clickup\`, \`email\`, \`calendar\`, \`x\`, \`github\`, \`news\`, \`agent\` — or another short lowercase word.
- \`title\` (string, required): the hook. Short, specific, human. Under ~80 chars.
- \`summary\` (string): one or two sentences shown under the title on the first slide.
- \`deep_link\` (string): URL back to the real item. Include whenever one exists.
- \`reply_placeholder\` (string): ADD THIS whenever you want an answer, decision, or input from the human. It renders a response box on the card with your text as the placeholder. Write it as the question or the expected answer shape — "yes / no / conditions…", "which day works?", "draft your reply here". Use it on every card that needs a decision; leave it off pure-FYI cards.
- \`slides\` (array): extra swipeable slides. Each: \`{ "title"?, "body"?, "image_url"?, "deep_link"? }\`. Use 2–4 slides for rich items (a thread: the ask / the context / your suggested reply). Omit for simple items.

## Replies from the human

The human can type a reply on any card. Replies reach you two ways:
- Your routine's trigger webhook fires immediately with \`{"reason": "user_replied", "card_id", "card_title", "reply"}\`.
- \`GET /agent/context\` returns a \`replies\` array (newest first). \`"new": true\` means it arrived since you last fetched context.

When you get a reply, treat it as a direct instruction from the human about that card. Act on it, then answer IN THE FEED: re-push the same card id with an added slide that responds (e.g. title "Your agent replied", body = what you did or found), or push a new follow-up card ranked near the top. Never ignore a new reply.

## Semantics

- \`"replace": true\` means you are curating the WHOLE feed this run: any active card you do not re-push gets rotated out. This is the recommended mode.
- \`"replace": false\` merges: existing cards stay, pushed cards upsert.
- Dismissed cards never come back, even if re-pushed with the same id. Dismissed = the human said done. If something dismissed becomes urgent again for a NEW reason, push it with a new id and say why it's back.
- \`seen: true\` in context means the card was viewed but not dismissed — still relevant, deprioritize gently rather than dropping it.

## Editorial rules

- 10–20 cards. Under 10 means you're not looking hard enough; over 20 means you're not ranking.
- Every card should answer: why does this person need to see this TODAY?
- Prefer items needing action or a decision, then items that changed, then FYI.
- Cards that need a decision should carry a \`reply_placeholder\` so the human can answer without leaving the feed. When they reply, you act on it and answer by re-pushing that card with a response slide.
- Write titles like a great editor, not a log line: "Acme deal moved to closing — contract needs signature" beats "ClickUp task updated".
- End rich cards with a suggested next action in the last slide when you have one.`;
}
