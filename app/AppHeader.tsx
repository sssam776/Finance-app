"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Me {
  email: string;
  displayName: string;
  role: "admin" | "viewer";
}

const NAV_ITEMS = [
  { href: "/", label: "Cash Position" },
  { href: "/entities", label: "Entities" },
  { href: "/imports", label: "Bank Imports" },
  { href: "/xero", label: "Xero Connections" },
];

export function AppHeader() {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const onLoginPage = pathname === "/login";

  useEffect(() => {
    if (onLoginPage) return;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d?.user ?? null))
      .catch(() => setMe(null));
  }, [onLoginPage, pathname]);

  // The sign-in page gets no chrome — there is nothing to navigate to yet.
  if (onLoginPage) return null;

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">Ramwall Finance Control</div>
          <div className="text-xs text-slate-500">
            Quick version — read-only slice, unverified data marked throughout
          </div>
        </div>

        <div className="flex items-center gap-6">
          <nav className="flex gap-4 text-sm">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className="text-slate-600 hover:text-slate-900">
                {item.label}
              </Link>
            ))}
          </nav>

          {me && (
            <div className="flex items-center gap-3 border-l border-slate-200 pl-6 text-sm">
              <div className="text-right leading-tight">
                <div className="text-slate-700">{me.displayName}</div>
                <div className="text-xs text-slate-400">{me.role}</div>
              </div>
              <button onClick={signOut} className="text-xs text-slate-500 underline hover:text-slate-800">
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
