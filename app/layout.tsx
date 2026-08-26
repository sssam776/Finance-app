import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import { AppHeader } from "./AppHeader";
import "./globals.css";

/**
 * The brand book's secondary typeface, and the one this app can use: its
 * primary, Blacker Sans Text, is a paid Zetafonts licence that cannot ship
 * here. The book nominates Roboto for exactly this role.
 *
 * Three weights, because the interface sets three. Each one is a file the
 * browser waits for.
 */
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ramwall Finance Control",
  description: "Ramwall Group finance control platform — quick version",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={roboto.variable}>
      <body>
        <div className="min-h-screen flex flex-col">
          <AppHeader />
          <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
