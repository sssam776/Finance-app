/**
 * Shared interface primitives.
 *
 * Every page was repeating the same panel, button, input and table-header
 * classes, which is how five screens drift apart one edit at a time. The
 * tokens they use are defined in tailwind.config.ts and explained in
 * DESIGN.local.md; nothing here should introduce a raw colour.
 */
import type { ReactNode } from "react";

export function PageHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-slate-900">{title}</h1>
      {children && <p className="mt-1 max-w-prose text-sm text-slate-500">{children}</p>}
    </div>
  );
}

/**
 * The second level, for a division within a page.
 *
 * Exists because three screens had hand-rolled their own and drifted: one used
 * `text-lg`, which is not a step in the type scale at all. The scale carries
 * hierarchy through weight rather than size, so a heading that reaches for a
 * larger font is working around the layout instead of using it.
 */
export function SectionHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border-b border-slate-200 pb-2">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {children && <p className="mt-1 max-w-prose text-sm text-slate-500">{children}</p>}
    </div>
  );
}

export function Panel({
  title,
  description,
  children,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  /**
   * Fill and elevation, no border. The system provisions one shadow for panels
   * and separately forbids border, shadow and fill on the same element.
   * Carrying all three gave every card two competing edges, which is most of
   * what made the app read as assembled rather than designed.
   */
  return (
    <section className="rounded bg-white p-5 shadow-panel">
      {title && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 max-w-prose text-xs text-slate-500">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Table wrapper. The scroll container lives here so no page forgets it. */
export function TableFrame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded bg-white shadow-panel">
      <table className="min-w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
}: {
  children?: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`whitespace-nowrap px-4 py-2.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-slate-200 bg-slate-100 text-left text-label uppercase text-slate-500">
      {children}
    </thead>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  const base =
    "rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
  const look =
    variant === "primary"
      ? "bg-accent text-white hover:bg-accent-hover"
      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  // className is destructured and appended rather than left in props. Spreading
  // props after the class attribute let a caller's className replace the whole
  // thing: the login button passed "w-full" and silently lost its colour,
  // padding, weight and disabled state.
  return (
    <button className={`${base} ${look} ${className ?? ""}`} {...props}>
      {children}
    </button>
  );
}

/**
 * A plain anchor rather than a button with a fetch. The browser's own download
 * handling carries the filename from Content-Disposition, streams without
 * holding the file in memory, and keeps working when the response is an error
 * page the user can then read.
 *
 * `disabled` is expressed by rendering a span, because an anchor has no
 * disabled state and one styled to look inert is still clickable.
 */
export function ExportCsvLink({
  href,
  disabled,
  children = "Export CSV",
}: {
  href: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const base = "rounded border px-3 py-1.5 text-sm font-medium";
  if (disabled) {
    return (
      <span className={`${base} border-slate-200 bg-white text-slate-400`} aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <a href={href} download className={`${base} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
      {children}
    </a>
  );
}

const FIELD =
  "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600">{label}</span>
      {hint && <span className="ml-1 text-xs text-slate-400">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD} w-full ${className ?? ""}`} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD} w-full ${className ?? ""}`} />;
}

/**
 * Status is spelled out, never carried by colour alone. Roughly one in twelve
 * men has a colour vision deficiency, and these labels sit next to money.
 */
export function StatusPill({ tone, children }: { tone: "healthy" | "stale" | "exception" | "neutral"; children: ReactNode }) {
  const look = {
    healthy: "bg-white text-healthy border border-healthy/30",
    stale: "bg-stale-bg text-stale border border-stale/20",
    exception: "bg-exception text-white",
    neutral: "bg-slate-100 text-slate-600 border border-slate-200",
  }[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${look}`}>{children}</span>;
}

/** A result line after an action. Says what happened, and what to do if it failed. */
export function Notice({ tone, children }: { tone: "ok" | "error" | "warn"; children: ReactNode }) {
  const look = {
    ok: "border-slate-200 bg-white text-slate-700",
    error: "border-exception/30 bg-exception-bg text-exception",
    warn: "border-stale/30 bg-stale-bg text-stale",
  }[tone];
  return <p className={`max-w-prose rounded border px-3 py-2 text-sm ${look}`}>{children}</p>;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-slate-400">
        {children}
      </td>
    </tr>
  );
}
