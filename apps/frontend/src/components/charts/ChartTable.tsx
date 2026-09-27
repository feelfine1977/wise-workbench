import type { ReactNode } from "react";

/** Native disclosure and table provide a keyboard-readable alternative to canvas tooltips. */
export function ChartTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="mt-2 text-sm text-text-muted">
      <summary className="cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Table alternative</summary>
      <div className="mt-2 overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
        <table className="tnum w-full text-sm [&_th]:px-2 [&_th]:py-2 [&_td]:px-2 [&_td]:py-2 [&_th]:align-top [&_td]:align-top [&_th]:[overflow-wrap:anywhere] [&_td]:[overflow-wrap:anywhere] [&_tbody_tr]:border-t [&_tbody_tr]:border-border">
          <caption className="sr-only">{label}</caption>
          {children}
        </table>
      </div>
    </details>
  );
}
