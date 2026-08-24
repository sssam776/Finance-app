"use client";

import { useEffect, useState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";
import { PageHeading, Panel, Button, Field, Input, Notice, StatusPill } from "../ui";

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
      <PageHeading title="Account">
        {me && (
          <>
            {me.displayName} · {me.email} <StatusPill tone="neutral">{me.role}</StatusPill>
          </>
        )}
      </PageHeading>

      <Panel
        title="Change password"
        description={`At least ${MIN_PASSWORD_LENGTH} characters. Changing it signs out your other sessions.`}
      >
        <form onSubmit={changePassword} className="space-y-4">
          <Field label="Current password">
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </Field>

          <Field label="New password">
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </Field>

          <Field label="Confirm new password">
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </Field>

          <Button type="submit" disabled={busy}>
            {busy ? "Changing…" : "Change password"}
          </Button>

          {message && <Notice tone={message.ok ? "ok" : "error"}>{message.text}</Notice>}
        </form>
      </Panel>
    </div>
  );
}
