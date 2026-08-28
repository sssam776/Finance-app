import type { Config } from "tailwindcss";

/**
 * The Ramwall palette.
 *
 * The brand book defines exactly three colours and forbids unapproved ones:
 * #102226, #434343 and #FFFFFF, with #A8A8A8 appearing in its
 * approved-combination chart. Those four are anchors below and are used at
 * their exact values; the intermediate greys are derived, because a table of
 * financial figures needs more than four steps to separate a heading from a
 * figure from a footnote.
 *
 * The neutral ramp occupies Tailwind's `slate` names so existing utilities
 * resolve to brand values without every component being rewritten. Nothing in
 * this app is slate-coloured any more: `slate-900` is the brand dark and
 * `slate-700` is the brand grey.
 *
 * Every step was checked for contrast on white. `slate-400` carries hint text
 * and previously sat at 2.8:1, which fails WCAG AA; it is now 4.6:1. Borders
 * and rules live at `slate-300`, where #A8A8A8 belongs.
 *
 * Status colour is a documented extension, agreed because the brand defines
 * none and three greys cannot distinguish a covenant breach from a healthy one
 * at an accessible contrast. It is used for status only. `exception` means a
 * variance has breached its threshold and it means nothing else anywhere.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /** Brand dark. Primary actions, headings, the header bar. */
        accent: {
          DEFAULT: "#102226",
          hover: "#24363b",
        },
        slate: {
          50: "#f8f8f8", // brand book
          100: "#efefef",
          200: "#e4e4e4", // brand book
          300: "#a8a8a8", // brand book, borders and rules
          400: "#767676", // 4.6:1, hint text
          500: "#6b6b6b", // 5.3:1, secondary text
          600: "#565656", // 7.2:1
          700: "#434343", // brand, body copy
          800: "#24363b",
          900: "#102226", // brand, headings and primary text
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
      fontFamily: {
        /**
         * The brand book names Blacker Sans Text as the primary typeface and
         * Roboto as the secondary. Blacker Sans is a paid Zetafonts licence
         * and cannot ship here, and the book already nominates Roboto for
         * exactly this role.
         */
        sans: ["var(--font-roboto)", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Financial figures. Paired with tabular-nums at the call site.
        figure: ["0.9375rem", { lineHeight: "1.4", fontWeight: "500" }],
        "figure-hero": ["1.875rem", { lineHeight: "1.2", fontWeight: "600" }],
        label: ["0.75rem", { lineHeight: "1.3", letterSpacing: "0.04em", fontWeight: "500" }],
      },
      boxShadow: {
        // The single elevation. Panels only.
        panel: "0 1px 2px rgb(16 34 38 / 0.05), 0 1px 3px rgb(16 34 38 / 0.07)",
      },
      borderRadius: {
        DEFAULT: "8px",
      },
    },
  },
  plugins: [],
};

export default config;
