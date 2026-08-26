"use client";

import { useState } from "react";
import { Button, Field, Input, Notice } from "../ui";

/**
 * Read from `window.location` rather than `useSearchParams` so this page does
 * not need a Suspense boundary. Only same-origin absolute paths are honoured —
 * `//evil.example` is a protocol-relative URL, not a local path, so it is
 * rejected along with anything else that is not a plain "/..." route.
 */
function safeNextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (res.ok) {
      window.location.href = safeNextPath();
      return;
    }

    const body = await res.json().catch(() => ({}));
    setError(body.error ?? "Sign in failed");
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-sm py-24">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-slate-900">
        Ramwall Finance Control
      </h1>
      <p className="mt-1 text-sm text-slate-500">Sign in to continue.</p>

      <form
        onSubmit={handleSubmit}
        className="mt-6 space-y-4 rounded border border-slate-200 bg-white p-6 shadow-panel"
      >
        <Field label="Email">
          <Input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>

        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </div>
  );
}
