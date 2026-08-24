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
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="rounded text-base font-semibold text-slate-900">
          Ramwall Finance Control
        </Link>

        <div className="flex items-center gap-5">
          <nav className="flex gap-4 text-sm">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "rounded font-medium text-slate-900"
                      : "rounded text-slate-500 hover:text-slate-900"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {me && (
            <div className="flex items-center gap-3 border-l border-slate-200 pl-5 text-sm">
              <Link href="/account" className="rounded leading-tight hover:opacity-80">
                <span className="text-slate-700">{me.displayName}</span>
                <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                  {me.role}
                </span>
              </Link>
              <button
                onClick={signOut}
                className="rounded text-sm text-accent hover:text-accent-hover hover:underline"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
