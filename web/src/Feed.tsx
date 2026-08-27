import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../backend/convex/_generated/api";
import type { Doc, Id } from "../../backend/convex/_generated/dataModel";
import { clearSecret, requestRefresh, sourceStyle, timeAgo } from "./lib";
import Settings from "./Settings";

type Card = Doc<"cards"> & { lastReply: { text: string; at: number } | null };

export default function Feed({ secret, onReset }: { secret: string; onReset: () => void }) {
  const cards = useQuery(api.cards.feed, { secret });
  const markSeen = useMutation(api.cards.markSeen);
  const dismissCard = useMutation(api.cards.dismiss);
  const sendReply = useMutation(api.cards.reply);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const seenSent = useRef<Set<string>>(new Set());

  function say(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3200);
  }

  // Mark a card seen once it fills most of the screen.
  useEffect(() => {
    const root = feedRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.cardId;
          if (e.isIntersecting && id && !seenSent.current.has(id)) {
            seenSent.current.add(id);
            markSeen({ secret, cardId: id as Id<"cards"> }).catch(() => {});
          }
        }
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll("[data-card-id]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [cards, markSeen, secret]);

  // Desktop keyboard nav: up/down = cards, left/right = slides of current card
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const root = feedRef.current;
      if (!root || (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      const cardEls = Array.from(root.querySelectorAll<HTMLElement>(".card"));
      if (cardEls.length === 0) return;
      const step = cardEls[0].offsetHeight + (cardEls[1] ? cardEls[1].offsetTop - cardEls[0].offsetTop - cardEls[0].offsetHeight : 0);
      const idx = Math.round(root.scrollTop / step);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        cardEls[Math.min(idx + 1, cardEls.length - 1)]?.scrollIntoView({ behavior: "smooth" });
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        cardEls[Math.max(idx - 1, 0)]?.scrollIntoView({ behavior: "smooth" });
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const slides = cardEls[idx]?.querySelector<HTMLElement>(".slides");
        if (slides) {
          e.preventDefault();
          slides.scrollBy({ left: e.key === "ArrowRight" ? slides.clientWidth : -slides.clientWidth, behavior: "smooth" });
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function refresh() {
    setRefreshing(true);
    const r = await requestRefresh(secret).catch(() => ({ ok: false, error: "network error" } as { ok: boolean; error?: string; status?: number }));
    setRefreshing(false);
    if (r.ok) say("Agent triggered — new cards will stream in.");
    else if (r.error?.includes("No agent webhook")) say("Add your agent's webhook in ⚙︎ settings to enable this.");
    else say(`Couldn't reach your agent: ${r.error ?? r.status}`);
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <span className="wordmark">📡 AgentFeed</span>
        <span className="topbar-actions">
          <button className="iconbtn" onClick={refresh} title="Wake your agent" aria-label="Refresh">
            <span className={refreshing ? "spin" : ""}>↻</span>
          </button>
          <button className="iconbtn" onClick={() => setShowSettings(true)} title="Settings" aria-label="Settings">⚙︎</button>
        </span>
      </div>

      {cards === undefined && <div className="fullmsg">Loading your feed…</div>}

      {cards !== undefined && cards.length === 0 && (
        <div className="fullmsg">
          <div className="empty-emoji">📭</div>
          <h2>Nothing here yet</h2>
          <p className="muted">
            Your feed fills the moment your agent pushes cards.
            It updates live — no need to reload.
          </p>
          <button className="cta" onClick={() => setShowSettings(true)}>Get the agent prompt</button>
        </div>
      )}

      {cards !== undefined && cards.length > 0 && (
        <div className="feed" ref={feedRef}>
          {cards.map((c, i) => (
            <CardView
              key={c._id}
              card={c}
              index={i}
              total={cards.length}
              onDismiss={() => {
                dismissCard({ secret, cardId: c._id }).catch(() => say("Couldn't dismiss"));
              }}
              onReply={async (text) => {
                try {
                  await sendReply({ secret, cardId: c._id, text });
                  say("Sent to your agent ✓");
                  return true;
                } catch {
                  say("Couldn't send reply");
                  return false;
                }
              }}
            />
          ))}
        </div>
      )}

      <div className="keys-hint">↑↓ cards · ←→ slides</div>
      {toast && <div className="toast">{toast}</div>}
      {showSettings && <Settings secret={secret} onClose={() => setShowSettings(false)} onReset={() => { clearSecret(); onReset(); }} />}
    </div>
  );
}

function CardView({ card, index, total, onDismiss, onReply }: { card: Card; index: number; total: number; onDismiss: () => void; onReply: (text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState<string | null>(null);

  async function submitReply() {
    const text = draft.trim();
    if (text === "" || sending) return;
    setSending(true);
    const ok = await onReply(text);
    setSending(false);
    if (ok) {
      setJustSent(text);
      setDraft("");
    }
  }

  const style = sourceStyle(card.source);
  const [slideIdx, setSlideIdx] = useState(0);
  const slidesRef = useRef<HTMLDivElement>(null);
  // slide 0 is the hero (title + summary); extra slides follow
  const slideCount = 1 + card.slides.length;

  function onSlidesScroll() {
    const el = slidesRef.current;
    if (!el) return;
    setSlideIdx(Math.round(el.scrollLeft / el.clientWidth));
  }

  const deepLink = card.slides[slideIdx - 1]?.deepLink ?? card.deepLink;

  return (
    <section
      className="card"
      data-card-id={card._id}
      style={{ background: `linear-gradient(160deg, ${style.grad[0]} 0%, ${style.grad[1]} 100%)` }}
    >
      {slideCount > 1 && (
        <div className="story-progress">
          {Array.from({ length: slideCount }, (_, i) => (
            <span key={i} className={i === slideIdx ? "seg active" : "seg"} />
          ))}
        </div>
      )}

      <div className="slides" ref={slidesRef} onScroll={onSlidesScroll}>
        <div className="slide">
          <div className="source-row">
            <span className="source-badge">{style.emoji} {card.source}</span>
            <span className="rank-badge">#{Math.round(card.rank)}</span>
          </div>
          <h2 className="card-title">{card.title}</h2>
          {card.summary && <p className="card-summary">{card.summary}</p>}
          {slideCount > 1 && <div className="swipe-hint">swipe for more →</div>}
        </div>
        {card.slides.map((s, i) => (
          <div className="slide" key={i}>
            {s.imageUrl && <img className="slide-img" src={s.imageUrl} alt="" loading="lazy" />}
            {s.title && <h3 className="slide-title">{s.title}</h3>}
            {s.body && <p className="slide-body">{s.body}</p>}
          </div>
        ))}
      </div>

      <div className="card-footer">
        {(justSent || card.lastReply) && (
          <div className="reply-bubble">
            <span className="reply-who">You → agent</span>
            {justSent ?? card.lastReply!.text}
          </div>
        )}
        {card.replyPrompt && (
          <div className="reply-row">
            <input
              className="reply-input"
              placeholder={card.replyPrompt}
              value={draft}
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Return") submitReply(); }}
            />
            <button
              className="reply-send"
              onClick={submitReply}
              disabled={sending || draft.trim() === ""}
              aria-label="Send reply"
            >{sending ? "…" : "➤"}</button>
          </div>
        )}
        <div className="meta">
          <span>{card.pushedBy} · {timeAgo(card.pushedAt)}</span>
          <span className="counter">{index + 1} / {total}</span>
        </div>
        <div className="actions">
          {deepLink && (
            <a className="action open" href={deepLink} target="_blank" rel="noreferrer">Open ↗</a>
          )}
          <button className="action done" onClick={onDismiss}>Done ✓</button>
        </div>
      </div>
    </section>
  );
}
