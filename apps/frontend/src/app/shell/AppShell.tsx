import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useJobStore } from "@/lib/stores/jobs";
import { useNavStore } from "@/lib/stores/nav";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import { useWorkbench } from "../context";
import { CommandPalette } from "./CommandPalette";
import { ContextRibbon } from "./ContextRibbon";
import { HelpDrawer } from "./HelpDrawer";
import { JobTray } from "./JobTray";
import { Stepper } from "./Stepper";

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** The three bands every screen shares — ribbon, stepper, page — plus the job tray, the palette and the help drawer. */
export function AppShell() {
  const { t } = useTranslation();
  const ctx = useWorkbench();
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const openHelp = useUiStore((s) => s.openHelp);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const href = useRouterState({ select: (s) => s.location.href });
  const record = useNavStore((s) => s.record);

  // Every location is remembered so a sub-screen's back control returns to the exact place the reader came from.
  useEffect(() => {
    record(href, pathname);
  }, [href, pathname, record]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "?" && !isEditable(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        openHelp();
      } else if (e.altKey && !e.metaKey && !e.ctrlKey && e.key === "ArrowLeft" && !isEditable(e.target)) {
        // Alt+← presses the screen's back control.
        const back = document.querySelector<HTMLElement>("[data-testid='back-control']");
        if (back) {
          e.preventDefault();
          back.click();
        }
      } else if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[1-7]$/.test(e.code) && !isEditable(e.target)) {
        // Alt+1 … Alt+7 jump to the steps of the analysis path.
        const index = e.code.slice(5);
        const step = document.querySelector<HTMLElement>(`[data-testid='stepper'] [data-step-index='${index}'] a, [data-testid='stepper'] [data-step-index='${index}'] button`);
        if (step) {
          e.preventDefault();
          step.click();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen, openHelp]);

  const trayShown = useJobStore((s) => s.jobs.some((j) => j.projectId === ctx.projectId));
  // The Flow step is the one screen the map owns end to end: it takes exactly the viewport, never scrolls,
  // and the map frame is what is left of the height after the bands above it (§3.2). Because the frame's
  // size then follows the viewport and not its own content, a fit can never change it back.
  const fixedToViewport = /\/flow$/.test(pathname);
  useEffect(() => {
    const root = document.documentElement;
    if (fixedToViewport) root.dataset.fixedViewport = "1";
    else delete root.dataset.fixedViewport;
    return () => {
      delete root.dataset.fixedViewport;
    };
  }, [fixedToViewport]);

  return (
    <div className={cn("flex flex-col", fixedToViewport ? "h-[100dvh] overflow-hidden" : "min-h-screen")} data-fixed-viewport={fixedToViewport ? "1" : undefined}>
      <a href="#main" className="skip-link">
        {t("app.skipToContent")}
      </a>
      <ContextRibbon ctx={ctx} />
      <Stepper ctx={ctx} />
      {/* Extra bottom padding keeps content reachable above the fixed job tray. */}
      <main
        id="main"
        tabIndex={-1}
        className={cn(
          "mx-auto w-full min-w-0 max-w-[1424px] px-8 outline-none",
          fixedToViewport ? "flex min-h-0 flex-1 flex-col overflow-hidden py-2" : "py-6",
          trayShown && !fixedToViewport && "pb-48",
        )}
      >
        <Outlet />
      </main>
      <JobTray projectId={ctx.projectId} />
      <CommandPalette ctx={ctx} />
      <HelpDrawer />
    </div>
  );
}
