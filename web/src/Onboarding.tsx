import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../backend/convex/_generated/api";
import { bootstrap, type BootstrapResult } from "./lib";

export default function Onboarding({ onDone }: { onDone: (secret: string) => void }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [boot, setBoot] = useState<BootstrapResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [hookUrl, setHookUrl] = useState("");
  const [hookKey, setHookKey] = useState("");
  const [hookHeader, setHookHeader] = useState("");
  const setWebhook = useMutation(api.accounts.setGrokWebhook);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const b = await bootstrap();
      setBoot(b);
      setStep(1);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    if (!boot) return;
    try {
      await navigator.clipboard.writeText(boot.prompt);
    } catch {
      // fallback: select-all textarea path below
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function saveHookAndFinish() {
    if (!boot) return;
    if (hookUrl.trim() !== "") {
      setBusy(true);
      try {
        await setWebhook({
          secret: boot.secret,
          url: hookUrl.trim(),
          key: hookKey.trim() || undefined,
          header: hookHeader.trim() || undefined,
        });
      } catch (e: any) {
        setError(String(e?.message ?? e));
        setBusy(false);
        return;
      }
    }
    onDone(boot.secret);
  }

  return (
    <div className="onboard">
      {step === 0 && (
        <div className="onboard-step">
          <div className="wordmark-big">📡 AgentFeed</div>
          <h1>Your agents already know what matters. This is where you scroll it.</h1>
          <p className="muted">
            Agents push ranked cards into your feed on a schedule.
            You open this and scroll. That's the whole app.
          </p>
          <button className="cta" onClick={create} disabled={busy}>
            {busy ? "Creating your feed…" : "Create my feed"}
          </button>
          {error && <p className="error">{error}</p>}
          <p className="fineprint">One tap. No email, no password — a private key is created for this device.</p>
        </div>
      )}

      {step === 1 && boot && (
        <div className="onboard-step">
          <div className="step-count">Step 1 of 2</div>
          <h2>Copy this prompt into your agent</h2>
          <p className="muted">
            Paste it as a routine in Grokbot (or any agent with schedules).
            Set it to run twice a day. Your key is already inside it.
          </p>
          <textarea className="prompt-box" readOnly value={boot.prompt} onFocus={(e) => e.currentTarget.select()} />
          <button className="cta" onClick={copyPrompt}>
            {copied ? "Copied ✓" : "Copy prompt"}
          </button>
          <button className="ghost" onClick={() => setStep(2)}>I pasted it →</button>
        </div>
      )}

      {step === 2 && boot && (
        <div className="onboard-step">
          <div className="step-count">Step 2 of 2 · optional</div>
          <h2>Let refresh wake your agent</h2>
          <p className="muted">
            After you save the routine, Grokbot shows a webhook
            (<b>POST to</b> / <b>key</b> / <b>header</b>). Paste it here and
            tapping refresh in your feed will trigger your agent on demand.
          </p>
          <label>POST to</label>
          <input placeholder="https://…" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} />
          <label>key</label>
          <input placeholder="webhook key" value={hookKey} onChange={(e) => setHookKey(e.target.value)} />
          <label>header</label>
          <input placeholder="header name (e.g. X-Api-Key)" value={hookHeader} onChange={(e) => setHookHeader(e.target.value)} />
          {error && <p className="error">{error}</p>}
          <button className="cta" onClick={saveHookAndFinish} disabled={busy}>
            {hookUrl.trim() ? "Save & open my feed" : "Skip — open my feed"}
          </button>
          <p className="fineprint">You can add or change this later in settings.</p>
        </div>
      )}
    </div>
  );
}
