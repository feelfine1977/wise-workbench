/** Number and date formatting through Intl (UX-29). Locale follows i18n; `en` for now. */
let locale = "en";
export function setLocale(next: string) {
  locale = next;
  cache.clear();
}

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function nf(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const k = "n" + JSON.stringify(options);
  let f = cache.get(k) as Intl.NumberFormat | undefined;
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    cache.set(k, f);
  }
  return f;
}
function df(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = "d" + JSON.stringify(options);
  let f = cache.get(k) as Intl.DateTimeFormat | undefined;
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    cache.set(k, f);
  }
  return f;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Integer counts: 1,595,923 */
export const fmtInt = (v: unknown): string => (isNum(v) ? nf({ maximumFractionDigits: 0 }).format(v) : "–");

/** Fixed decimals for tables and popovers (full precision on demand). */
export const fmtNum = (v: unknown, digits = 3): string =>
  isNum(v) ? nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v) : "–";

/** Two significant figures for prose ("gap 0.18", "PI 950"). */
export const fmtSig = (v: unknown, sig = 2): string =>
  isNum(v) ? nf({ maximumSignificantDigits: sig, minimumSignificantDigits: 1 }).format(v) : "–";

/** Percentages from a share in [0, 1]: "18 %" (non-breaking space as in en typography of this app). */
export const fmtPct = (v: unknown, digits = 0): string =>
  isNum(v) ? nf({ style: "percent", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v) : "–";

/**
 * A share of something, with the precision the number needs: near either end one number rounded to
 * whole percent says something that is not true — 99.945 % of items is not "100 %", and neither is 0.4 %
 * "0 %". Away from the ends the decimals only add noise.
 */
export const fmtShare = (v: unknown): string =>
  !isNum(v) ? "–" : v >= 1 || v <= 0 ? fmtPct(v, 0) : v > 0.99 || v < 0.01 ? fmtPct(v, 2) : v > 0.9 || v < 0.1 ? fmtPct(v, 1) : fmtPct(v, 0);

/** Compact numbers for axes: 1.6M */
export const fmtCompact = (v: unknown): string =>
  isNum(v) ? nf({ notation: "compact", maximumFractionDigits: 1 }).format(v) : "–";

export const fmtDate = (v: string | number | Date | undefined | null): string => {
  if (v === undefined || v === null || v === "") return "–";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : df({ dateStyle: "medium" }).format(d);
};

export const fmtDateTime = (v: string | number | Date | undefined | null): string => {
  if (v === undefined || v === null || v === "") return "–";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : df({ dateStyle: "medium", timeStyle: "short" }).format(d);
};

/** Duration in days with a unit label ("3.5 d", "12 h"). */
export const fmtDays = (days: unknown): string => {
  if (!isNum(days)) return "–";
  if (Math.abs(days) < 1) return `${fmtNum(days * 24, 1)} h`;
  return `${fmtNum(days, Math.abs(days) < 10 ? 1 : 0)} d`;
};

/** Bytes for uploads. */
export const fmtBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${fmtNum(v, v < 10 ? 1 : 0)} ${units[i]}`;
};
