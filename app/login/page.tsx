"use client";

import { useState } from "react";

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
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-slate-500">Ramwall Finance Control</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-3 rounded-lg border border-slate-200 bg-white p-5">
        <label className="block text-sm">
          <span className="text-slate-600">Email</span>
          <input
            type="email"
            autoComplete="username"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-600">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
