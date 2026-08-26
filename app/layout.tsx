import type { Metadata } from "next";
import { AppHeader } from "./AppHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ramwall Finance Control",
  description: "Ramwall Group finance control platform — quick version",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          <AppHeader />
          <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
