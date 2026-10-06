"use client";

import { useActionState } from "react";
import { createApiKey, type CreateKeyState } from "./apiKeyActions";

export function ApiKeyCreator() {
  const [state, action, pending] = useActionState<CreateKeyState, FormData>(createApiKey, {});
  return (
    <div className="stack">
      <form action={action} className="row">
        <input id="api-key-name" name="name" placeholder="Name, e.g. Website" maxLength={60} />
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create API key"}
        </button>
      </form>
      {state.error ? <p className="notice error">{state.error}</p> : null}
      {state.key ? (
        <div className="notice ok">
          <div>Copy this key into the website now. It will not be shown again.</div>
          <code className="secret">{state.key}</code>
        </div>
      ) : null}
    </div>
  );
}
