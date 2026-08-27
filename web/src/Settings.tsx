import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../backend/convex/_generated/api";
import { APP_URL } from "./lib";

export default function Settings({ secret, onClose, onReset }: { secret: string; onClose: () => void; onReset: () => void }) {
  const onboarding = useQuery(api.accounts.onboarding, { secret });
  const me = useQuery(api.accounts.me, { secret });
  const setWebhook = useMutation(api.accounts.setGrokWebhook);
  const [copied, setCopied] = useState(false);
  const [hookUrl, setHookUrl] = useState("");
  const [hookKey, setHookKey] = useState("");
  const [hookHeader, setHookHeader] = useState("");
  const [saved, setSaved] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [qrRevealed, setQrRevealed] = useState(false);

  const transferUrl = `${APP_URL}/#s=${secret}`;

  useEffect(() => {
    QRCode.toDataURL(transferUrl, {
      width: 480,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [transferUrl]);
  const [loadedFromMe, setLoadedFromMe] = useState(false);

  useEffect(() => {
    if (me && !loadedFromMe) {
      setHookUrl(me.grokWebhookUrl ?? "");
      setHookKey(me.grokWebhookKey ?? "");
      setHookHeader(me.grokWebhookHeader ?? "");
      setLoadedFromMe(true);
    }
  }, [me, loadedFromMe]);

  async function copyPrompt() {
    if (!onboarding) return;
    try { await navigator.clipboard.writeText(onboarding.prompt); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function save() {
    await setWebhook({
      secret,
      url: hookUrl.trim(),
      key: hookKey.trim() || undefined,
      header: hookHeader.trim() || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>Settings</h2>

        <h3>Agent prompt</h3>
        <p className="muted small">Paste into any agent that can run scheduled routines. Your write key is inside.</p>
        <textarea className="prompt-box small" readOnly value={onboarding?.prompt ?? "…"} onFocus={(e) => e.currentTarget.select()} />
        <button className="cta" onClick={copyPrompt}>{copied ? "Copied ✓" : "Copy prompt"}</button>

        <h3>Agent webhook (refresh trigger)</h3>
        <p className="muted small">From Grokbot's routine after saving: POST to / key / header.</p>
        <label>POST to</label>
        <input placeholder="https://…" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} />
        <label>key</label>
        <input placeholder="webhook key" value={hookKey} onChange={(e) => setHookKey(e.target.value)} />
        <label>header</label>
        <input placeholder="header name (e.g. X-Api-Key)" value={hookHeader} onChange={(e) => setHookHeader(e.target.value)} />
        <button className="cta" onClick={save}>{saved ? "Saved ✓" : "Save webhook"}</button>

        <h3>Sign in on your phone</h3>
        <p className="muted small">
          Scan with your phone camera, then Share → Add to Home Screen.
          This code is your private key — it stays hidden until you tap it,
          so it never lands in a screen recording by accident.
        </p>
        <div
          className={qrRevealed ? "qr-wrap revealed" : "qr-wrap"}
          onClick={() => setQrRevealed((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setQrRevealed((v) => !v); }}
        >
          {qr ? <img src={qr} alt="Sign-in QR code" /> : <div className="qr-placeholder">…</div>}
          {!qrRevealed && <span className="qr-veil">Tap to reveal</span>}
        </div>
        <button
          className="cta"
          onClick={async () => {
            try { await navigator.clipboard.writeText(transferUrl); } catch {}
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2000);
          }}
        >{linkCopied ? "Copied ✓" : "Copy transfer link instead"}</button>

        <h3>Danger</h3>
        <button className="ghost danger" onClick={() => { if (confirm("Disconnect this device from your feed? Your cards stay in the cloud; the key on this device is forgotten.")) onReset(); }}>
          Reset this device
        </button>

        <button className="ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
