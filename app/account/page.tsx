"use client";

import { useEffect, useState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";

interface Me {
  email: string;
  displayName: string;
  role: "admin" | "viewer";
}

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d?.user ?? null))
      .catch(() => setMe(null));
  }, []);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();

    // Checked here purely to save a round trip; the route enforces the real
    // rules regardless of what this form allows.
    if (newPassword !== confirmPassword) {
      setMessage({ ok: false, text: "The two new passwords do not match." });
      return;
    }

    setBusy(true);
    setMessage(null);

    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const body = await res.json().catch(() => ({}));

    if (res.ok) {
      const revoked = body.otherSessionsRevoked ?? 0;
      setMessage({
        ok: true,
        text:
          revoked > 0
            ? `Password changed. ${revoked} other session${revoked === 1 ? "" : "s"} signed out.`
            : "Password changed.",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      setMessage({ ok: false, text: body.error ?? "Could not change password." });
    }

    setBusy(false);
  }

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Account</h1>
        {me && (
          <p className="text-sm text-slate-500">
            {me.displayName} ({me.email}) — {me.role}
          </p>
        )}
      </div>

      <form onSubmit={changePassword} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
        <div>
          <h2 className="text-sm font-medium">Change password</h2>
          <p className="text-xs text-slate-500">
            At least {MIN_PASSWORD_LENGTH} characters. Changing it signs out your other sessions.
          </p>
        </div>

        <label className="block text-sm">
          <span className="text-slate-600">Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-600">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-600">Confirm new password</span>
          <input
            type="password"
            autoComplete="new-password"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? "Changing…" : "Change password"}
        </button>

        {message && (
          <p className={`text-sm ${message.ok ? "text-emerald-600" : "text-red-600"}`}>{message.text}</p>
        )}
      </form>
    </div>
  );
}
