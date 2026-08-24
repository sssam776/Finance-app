import type { Config } from "tailwindcss";

/**
 * Tokens from DESIGN.local.md. Components reference these names, never a raw
 * hex value, so the palette stays changeable in one place.
 *
 * One accent, one neutral family, and a semantic set whose colours carry
 * meaning nothing else is allowed to borrow: `exception` means a variance has
 * breached its threshold, and it means nothing else anywhere in the app.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#1e5c8f",
          hover: "#17496f",
        },
        // Semantic. Do not use for decoration.
        exception: {
          DEFAULT: "#b42318",
          bg: "#fef3f2",
        },
        stale: {
          DEFAULT: "#b54708",
          bg: "#fffaeb",
        },
        healthy: {
          DEFAULT: "#067647",
        },
      },
      fontSize: {
        // Financial figures. Paired with tabular-nums at the call site.
        figure: ["0.9375rem", { lineHeight: "1.4", fontWeight: "500" }],
        "figure-hero": ["1.875rem", { lineHeight: "1.2", fontWeight: "600" }],
        label: ["0.75rem", { lineHeight: "1.3", letterSpacing: "0.04em", fontWeight: "500" }],
      },
      boxShadow: {
        // The single elevation. Panels only.
        panel: "0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.06)",
      },
      borderRadius: {
        DEFAULT: "8px",
      },
    },
  },
  plugins: [],
};

export default config;
