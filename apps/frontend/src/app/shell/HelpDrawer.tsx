import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/misc";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { glossary } from "@/lib/glossary";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";

const formulas = [
  { name: "Gap", formula: "gap_s = (μ̄ − μ_s)₊" },
  { name: "Priority Index", formula: "PI_s = n_s · (μ̄ − μ_s)₊" },
  { name: "Shrinkage", formula: "μ̃_s = n_s/(n_s+γ) · μ_s + γ/(n_s+γ) · μ̄" },
  { name: "Stable gap", formula: "(μ̄ − μ̃_s)₊ = n_s/(n_s+γ) · (μ̄ − μ_s)₊" },
  { name: "Stable PI", formula: "PĨ_s = n_s · (μ̄ − μ̃_s)₊" },
  { name: "Lower bound", formula: "PI_lower = n_s · (stable gap − z · se)₊,  se = sd_s / √n_s" },
  { name: "Soft violation", formula: "ν(x) = clip((x − ϑ) / W, 0, 1)" },
];

/** Help drawer (UX-18): glossary, formulas and the keyboard map. */
export function HelpDrawer() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.helpOpen);
  const term = useUiStore((s) => s.helpTerm);
  const close = useUiStore((s) => s.closeHelp);
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDListElement>(null);

  const entries = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? glossary.filter((g) => g.term.toLowerCase().includes(needle) || g.method.toLowerCase().includes(needle) || g.definition.toLowerCase().includes(needle) || (g.reworded ?? "").toLowerCase().includes(needle)) : glossary;
  }, [q]);

  useEffect(() => {
    if (open && term) {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-term="${term}"]`);
      el?.scrollIntoView({ block: "center" });
      el?.focus();
    }
  }, [open, term]);

  const keys = [
    ["⌘K / Ctrl K", t("help.keys.palette")],
    ["?", t("help.keys.help")],
    ["/", t("help.keys.filter")],
    ["Right click / ↵ on the map", "Actions on an activity or a path: filter to, exclude, paths, lens"],
    ["↑ ↓", t("help.keys.move")],
    ["↵", t("help.keys.open")],
    ["p", t("help.keys.pin")],
    ["f", t("help.keys.finding")],
    ["Esc", t("help.keys.escape")],
  ];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent className="max-w-lg">
        <div className="border-b border-border px-5 py-4">
          <SheetTitle className="text-lg font-semibold">{t("help.title")}</SheetTitle>
          <SheetDescription className="text-sm text-text-muted">Plain words first, the method's term beside each, the wording the comprehension test settled on, formulas and keys. Descriptive wording throughout: priorities are evidence for hypotheses, not causes.</SheetDescription>
        </div>
        <Tabs defaultValue={term ? "glossary" : "glossary"} className="flex min-h-0 flex-1 flex-col px-5 py-3">
          <TabsList aria-label="Help sections">
            <TabsTrigger value="glossary">{t("help.glossary")}</TabsTrigger>
            <TabsTrigger value="formulas">{t("help.formulas")}</TabsTrigger>
            <TabsTrigger value="keyboard">{t("help.keyboard")}</TabsTrigger>
          </TabsList>
          <TabsContent value="glossary" className="flex min-h-0 flex-1 flex-col">
            <Input aria-label="Search the glossary" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
            <dl ref={listRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
              {entries.map((g) => (
                <div key={g.id} data-term={g.id} tabIndex={-1} className={cn("mb-3 rounded-sm p-1 outline-none", term === g.id && "bg-selection")}>
                  <dt className="text-sm font-semibold">
                    {g.term}
                    {g.method !== g.term && <span className="ml-2 text-xs font-normal text-text-subtle">method: {g.method}</span>}
                  </dt>
                  <dd className="text-sm text-text-muted">{g.definition}</dd>
                  {g.reworded && (
                    <dd className="text-sm text-text-muted">
                      <span className="text-xs uppercase tracking-wide text-text-subtle">on the screens: </span>
                      {g.reworded}
                    </dd>
                  )}
                  {g.formula && (
                    <dd>
                      <code className="mt-1 block whitespace-pre-wrap rounded bg-surface-sunken px-2 py-1 font-mono text-xs">{g.formula}</code>
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          </TabsContent>
          <TabsContent value="formulas" className="overflow-y-auto">
            <dl className="flex flex-col gap-3">
              {formulas.map((f) => (
                <div key={f.name}>
                  <dt className="text-sm font-semibold">{f.name}</dt>
                  <dd>
                    <code className="block whitespace-pre-wrap rounded bg-surface-sunken px-2 py-1 font-mono text-xs">{f.formula}</code>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-text-muted">γ is in units of cases: a slice with n = γ keeps half of its observed gap. Stable PI is the headline; raw PI sits beside it; γ is printed on every backlog.</p>
          </TabsContent>
          <TabsContent value="keyboard">
            <table className="w-full text-sm">
              <tbody>
                {keys.map(([k, d]) => (
                  <tr key={k} className="border-b border-border">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                      <Kbd>{k}</Kbd>
                    </th>
                    <td className="py-1.5 text-text-muted">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
