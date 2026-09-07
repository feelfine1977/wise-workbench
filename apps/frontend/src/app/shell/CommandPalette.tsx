import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/misc";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import type { WorkbenchContext } from "../context";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Command palette placeholder (UX-12): jump to a screen; object search arrives in v1. */
export function CommandPalette({ ctx }: { ctx: WorkbenchContext }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const openHelp = useUiStore((s) => s.openHelp);
  const setTheme = useUiStore((s) => s.setTheme);
  const theme = useUiStore((s) => s.theme);
  const vocabulary = useUiStore((s) => s.vocabulary);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const pid = ctx.projectId;

  const commands = useMemo<Command[]>(() => {
    const runId = ctx.run?.status === "done" ? ctx.run.id : undefined;
    const list: Command[] = [
      // the hint says what the screen is for, never which stage of a process it belongs to (P1-13)
      { id: "dashboard", label: "Dashboard", hint: "where the run stands", run: () => void navigate({ to: "/p/$projectId", params: { projectId: pid } }) },
      { id: "data", label: "Data and mapping", hint: "the log and what its columns mean", run: () => void navigate({ to: "/p/$projectId/data", params: { projectId: pid } }) },
      { id: "norms", label: "Norms", hint: "what the process is expected to do", run: () => void navigate({ to: "/p/$projectId/norms", params: { projectId: pid } }) },
      { id: "runs", label: "Runs", hint: "what has been scored", run: () => void navigate({ to: "/p/$projectId/runs", params: { projectId: pid } }) },
    ];
    if (runId) {
      list.push({
        id: "backlog",
        label: `${vocabulary === "plain" ? "Where is it worst?" : "Backlog explorer"} · ${runId}`,
        hint: "the groups, worst first",
        run: () => void navigate({ to: "/p/$projectId/runs/$runId/backlog", params: { projectId: pid, runId }, search: { slicing: ctx.slicing, view: ctx.view } }),
      });
      for (const v of ctx.run?.views ?? []) {
        list.push({ id: `view-${v}`, label: `Switch ${vocabulary === "plain" ? "perspective" : "view"} to ${v}`, hint: "context", run: () => ctx.setView(v) });
      }
      for (const s of ctx.run?.slicings ?? []) {
        if (s.id) list.push({ id: `slicing-${s.id}`, label: `${vocabulary === "plain" ? "Group" : "Slice"} by ${s.id}`, hint: "context", run: () => ctx.setSlicing(s.id as string) });
      }
    }
    list.push({ id: "help", label: "Help and glossary", hint: "?", run: () => openHelp() });
    list.push({ id: "theme", label: `Theme: ${theme} → ${theme === "dark" ? "light" : "dark"}`, hint: "ui", run: () => setTheme(theme === "dark" ? "light" : "dark") });
    return list;
  }, [ctx, navigate, pid, openHelp, setTheme, theme, vocabulary]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? commands.filter((c) => c.label.toLowerCase().includes(needle) || c.hint?.toLowerCase().includes(needle)) : commands;
  }, [commands, q]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [q]);

  const runCommand = (c: Command | undefined) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-24 translate-y-0 p-0" hideClose aria-describedby={undefined}>
        <DialogTitle className="sr-only">{t("ribbon.palette")}</DialogTitle>
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={filtered[active] ? `palette-${filtered[active]?.id}` : undefined}
          aria-autocomplete="list"
          aria-label={t("ribbon.palette")}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(filtered.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              runCommand(filtered[active]);
            }
          }}
          placeholder={t("palette.placeholder")}
          className="h-11 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-text-subtle"
        />
        <ul id="palette-list" role="listbox" className="max-h-80 overflow-y-auto p-1">
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-text-muted">{t("palette.noResults")}</li>}
          {filtered.map((c, i) => (
            <li
              key={c.id}
              id={`palette-${c.id}`}
              role="option"
              aria-selected={i === active}
              className={cn("flex cursor-pointer items-center justify-between rounded-sm px-3 py-1.5 text-sm", i === active && "bg-selection")}
              onMouseEnter={() => setActive(i)}
              onClick={() => runCommand(c)}
            >
              <span>{c.label}</span>
              {c.hint && <span className="text-xs text-text-subtle">{c.hint}</span>}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-xs text-text-subtle">
          <Kbd>↑↓</Kbd> <Kbd>↵</Kbd> {t("palette.hint")}
        </div>
      </DialogContent>
    </Dialog>
  );
}
