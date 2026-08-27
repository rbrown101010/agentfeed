import { useState } from "react";
import Onboarding from "./Onboarding";
import Feed from "./Feed";
import { loadSecret, saveSecret } from "./lib";

export default function App() {
  const [secret, setSecret] = useState<string | null>(loadSecret());

  if (!secret) {
    return (
      <Onboarding
        onDone={(s) => {
          saveSecret(s);
          setSecret(s);
        }}
      />
    );
  }
  return <Feed secret={secret} onReset={() => setSecret(null)} />;
}
