import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { glossaryById } from "@/lib/glossary";
import { cn } from "@/lib/utils";

export interface ExplainInput {
  label: string;
  value: ReactNode;
  href?: string;
}

export interface ExplainProps {
  /** Glossary id: provides term, definition and formula. */
  term: string;
  title?: string;
  formula?: string;
  inputs?: ExplainInput[];
  caveats?: string[];
  children?: ReactNode;
  className?: string;
  /** Accessible name; defaults to "Explain this number: <term>". */
  ariaLabel?: string;
}

/** "Explain this number" (UX-3): formula, inputs with links, uncertainty and caveats. */
export function Explain({ term, title, formula, inputs, caveats, children, className, ariaLabel }: ExplainProps) {
  const { t } = useTranslation();
  const g = glossaryById[term];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel ?? `${t("explain.trigger")}: ${g?.term ?? title ?? term}`}
          className={cn("inline-flex size-4 items-center justify-center rounded-full text-text-subtle hover:text-accent-text focus-visible:text-accent-text", className)}
        >
          <HelpCircle className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96">
        <p className="mb-1 text-sm font-semibold">
          {title ?? g?.term ?? term}
          {g && g.method !== g.term && <span className="ml-2 text-xs font-normal text-text-subtle">method: {g.method}</span>}
        </p>
        {g && <p className="mb-2 text-xs text-text-muted">{g.definition}</p>}
        {(formula ?? g?.formula) && (
          <div className="mb-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">{t("explain.formula")}</p>
            <code className="block whitespace-pre-wrap rounded bg-surface-sunken px-2 py-1 font-mono text-xs">{formula ?? g?.formula}</code>
          </div>
        )}
        {inputs && inputs.length > 0 && (
          <div className="mb-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">{t("explain.inputs")}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {inputs.map((i) => (
                <div key={i.label} className="contents">
                  <dt className="text-text-muted">{i.label}</dt>
                  <dd className="tnum">{i.href ? <a className="text-accent-text underline" href={i.href}>{i.value}</a> : i.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {caveats && caveats.length > 0 && (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">{t("explain.caveats")}</p>
            <ul className="list-disc pl-4 text-xs text-text-muted">
              {caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        {children}
      </PopoverContent>
    </Popover>
  );
}

export interface MetricProps {
  label: string;
  value: ReactNode;
  unit?: string;
  explain?: Omit<ExplainProps, "children">;
  className?: string;
  size?: "sm" | "md" | "lg";
  sub?: ReactNode;
}

/** A number with its label and an explain popover. */
export function Metric({ label, value, unit, explain, className, size = "md", sub }: MetricProps) {
  const valueClass = { sm: "text-md", md: "text-xl", lg: "text-2xl" }[size];
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <div className="flex items-center gap-1 text-xs text-text-muted">
        <span>{label}</span>
        {explain && <Explain {...explain} />}
      </div>
      <div className={cn("tnum font-semibold leading-tight text-text", valueClass)}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-text-subtle">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-text-subtle">{sub}</div>}
    </div>
  );
}

/** Formula content for backlog metrics; inputs shared by the table popovers and the slice header. */
export function backlogExplain(
  column: "gap" | "PI" | "stable_gap" | "stable_PI" | "mean_score" | "n_cases" | "PI_lower",
  row: { n_cases: number; mean_score: number; gap: number; stable_gap: number; PI: number; stable_PI: number; PI_lower?: number | null },
  params: { globalMean?: number; gamma?: number; view?: string; minCases?: number; z?: number },
  fmt: { num: (v: unknown, d?: number) => string; int: (v: unknown) => string },
): Omit<ExplainProps, "children"> {
  const mu = params.globalMean;
  const gamma = params.gamma ?? 0;
  const n = row.n_cases;
  const shrink = gamma > 0 ? n / (n + gamma) : 1;
  const base = [
    { label: "n", value: fmt.int(n) },
    { label: "μ̄ (global mean)", value: fmt.num(mu, 4) },
    { label: "μ_s (slice mean)", value: fmt.num(row.mean_score, 4) },
  ];
  switch (column) {
    case "n_cases":
      return { term: "n_cases", inputs: [{ label: "min cases", value: fmt.int(params.minCases ?? 20) }, { label: "view", value: params.view ?? "–" }] };
    case "mean_score":
      return { term: "mean_score", inputs: [{ label: "view", value: params.view ?? "–" }, { label: "n", value: fmt.int(n) }] };
    case "gap":
      return { term: "gap", inputs: [...base, { label: "gap", value: fmt.num(row.gap, 4) }] };
    case "PI":
      return { term: "PI", inputs: [...base, { label: "gap", value: fmt.num(row.gap, 4) }, { label: "PI", value: fmt.num(row.PI, 2) }] };
    case "stable_gap":
      return {
        term: "stable_gap",
        inputs: [...base, { label: "γ", value: fmt.num(gamma, 0) }, { label: "n/(n+γ)", value: fmt.num(shrink, 3) }, { label: "stable gap", value: fmt.num(row.stable_gap, 4) }],
        caveats: gamma > 0 && shrink < 0.6 ? [`With n = ${fmt.int(n)} and γ = ${fmt.num(gamma, 0)} this slice keeps only ${fmt.num(shrink * 100, 0)} % of its observed gap.`] : undefined,
      };
    case "stable_PI":
      return { term: "stable_PI", inputs: [{ label: "n", value: fmt.int(n) }, { label: "stable gap", value: fmt.num(row.stable_gap, 4) }, { label: "stable PI", value: fmt.num(row.stable_PI, 2) }] };
    case "PI_lower":
      return { term: "PI_lower", inputs: [{ label: "z", value: fmt.num(params.z ?? 1.64, 2) }, { label: "PI_lower", value: fmt.num(row.PI_lower, 2) }] };
  }
}
