import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ReadinessBanner } from "@/components/readiness";
import { useJobStore } from "@/lib/stores/jobs";
import { useNavStore } from "@/lib/stores/nav";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import { useWorkbench } from "../context";
import { CommandPalette } from "./CommandPalette";
import { ContextRibbon } from "./ContextRibbon";
import { HelpDrawer } from "./HelpDrawer";
import { JobTray } from "./JobTray";
import { JourneyRail } from "./JourneyRail";
import { Stepper } from "./Stepper";

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** The shell every screen shares: ribbon, journey rail, main region, job tray, palette, help. */
export function AppShell() {
  const { t } = useTranslation();
  const ctx = useWorkbench();
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const openHelp = useUiStore((s) => s.openHelp);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const href = useRouterState({ select: (s) => s.location.href });
  const onDatasetScreen = /\/data\/[^/]+/.test(pathname);
  const record = useNavStore((s) => s.record);

  // Every location is remembered so a sub-screen's back control returns to the exact place the reader came from (R2-O6).
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen, openHelp]);

  const trayShown = useJobStore((s) => s.jobs.some((j) => j.projectId === ctx.projectId));
  const readiness = ctx.caseTable?.readiness;
  const showBanner = !onDatasetScreen && readiness && readiness.status && readiness.status !== "pass";

  return (
    <div className="min-h-screen">
      <a href="#main" className="skip-link">
        {t("app.skipToContent")}
      </a>
      <ContextRibbon ctx={ctx} />
      <Stepper ctx={ctx} />
      {showBanner && <ReadinessBanner readiness={readiness} projectId={ctx.projectId} datasetId={ctx.caseTable?.datasetId} compact />}
      <div className="flex">
        <JourneyRail ctx={ctx} />
        {/* Extra bottom padding keeps content reachable above the fixed job tray. */}
        <main id="main" tabIndex={-1} className={cn("mx-auto w-full min-w-0 max-w-[1400px] flex-1 px-6 py-5 outline-none", trayShown && "pb-48")}>
          <Outlet />
        </main>
      </div>
      <JobTray projectId={ctx.projectId} />
      <CommandPalette ctx={ctx} />
      <HelpDrawer />
    </div>
  );
}
