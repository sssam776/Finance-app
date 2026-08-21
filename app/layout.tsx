import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ramwall Finance Control",
  description: "Ramwall Group finance control platform — quick version",
};

const NAV_ITEMS = [
  { href: "/", label: "Cash Position" },
  { href: "/entities", label: "Entities" },
  { href: "/imports", label: "Bank Imports" },
  { href: "/xero", label: "Xero Connections" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold">Ramwall Finance Control</div>
                <div className="text-xs text-slate-500">
                  Quick version — read-only slice, unverified data marked throughout
                </div>
              </div>
              <nav className="flex gap-4 text-sm">
                {NAV_ITEMS.map((item) => (
                  <Link key={item.href} href={item.href} className="text-slate-600 hover:text-slate-900">
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
