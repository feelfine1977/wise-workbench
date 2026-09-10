/**
 * The knowledge hub of the project's process (R3-05, RK-3): every node of the pack — stage, expectation
 * area, expectation, failure mode, usual reason, usual action, indicator — reachable as a page, navigated
 * stage → expectation area → expectation → failure mode and searchable over the plain and the method names.
 *
 * The index is one request; the pages are read one at a time, so a pack of six hundred nodes costs one list.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useWorkbench } from "@/app/context";
import { knowledgeRoute } from "@/app/router";
import { hubQuery, type HubNode } from "@/lib/api/knowledge";
import { notServed } from "@/lib/api/compatibility";
import { KIND_WORDS } from "@/components/knowledge/words";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/misc";
import { fmtInt } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The order the hub is walked in (`knowledge_hub_panel.md` §3), not the order the pack lists. */
const KIND_ORDER = ["stage", "layer", "expectation", "failure_mode", "kpi", "reason", "action"] as const;

const nameOf = (n: HubNode) => n.plain_name ?? n.method_name ?? n.id;

export default function KnowledgeHubPage() {
  const ctx = useWorkbench();
  const search = knowledgeRoute.useSearch();
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? "");
  const index = useQuery(hubQuery(ctx.projectId));

  const byKind = useMemo(() => {
    const nodes = index.data?.nodes ?? [];
    const needle = q.trim().toLowerCase();
    const matching = needle ? nodes.filter((n) => `${nameOf(n)} ${n.method_name ?? ""} ${n.id}`.toLowerCase().includes(needle)) : nodes;
    const map = new Map<string, HubNode[]>();
    for (const n of matching) map.set(n.kind, [...(map.get(n.kind) ?? []), n]);
    for (const list of map.values()) list.sort((a, b) => ((a as { order?: number }).order ?? 0) - ((b as { order?: number }).order ?? 0) || nameOf(a).localeCompare(nameOf(b)));
    return map;
  }, [index.data, q]);

  const total = index.data?.nodes?.length ?? 0;
  const shown = [...byKind.values()].reduce((s, l) => s + l.length, 0);

  if (index.isPending) return <LoadingBlock rows={10} />;
  if (index.isError) {
    return notServed(index.error) ? (
      <EmptyState
        title="This workspace has no knowledge hub yet."
        reason="The hub is served from the project's process pack. This backend does not carry one, so the words behind the expectations are not available here."
        action={{ label: "Back to the dashboard", to: "/p/$projectId", params: { projectId: ctx.projectId } }}
      />
    ) : (
      <ErrorBlock error={index.error} retry={() => void index.refetch()} />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wide text-text-subtle">Knowledge hub</span>
        {/* the pack's id is not the name of a process: the title read "What the words mean in p2p" (P1-13) */}
        <h1 className="text-2xl font-semibold">What the words mean in this process</h1>
        <p className="reading text-base text-text-muted">
          Every stage, expectation area, expectation and failure mode of this process has a page: what it means, why it matters, how we detect it, what usually causes it and what usually helps. The reason and remedy texts on the
          other screens are the same pages, so a word means one thing here and there.
        </p>
        <label className="flex max-w-md items-center gap-2 rounded border border-border bg-surface px-2">
          <Search className="size-4 shrink-0 text-text-subtle" aria-hidden />
          <span className="sr-only">Search the hub</span>
          <Input
            value={q}
            className="h-9 border-0 px-0"
            placeholder="Search a word — “late”, “maverick”, “goods receipt”…"
            onChange={(e) => {
              setQ(e.target.value);
              void navigate({ to: ".", search: () => ({ q: e.target.value || undefined }), replace: true });
            }}
          />
        </label>
        <p className="text-sm text-text-muted" data-testid="hub-count">
          {q.trim() ? `${fmtInt(shown)} of ${fmtInt(total)} pages match` : `${fmtInt(total)} pages`}
          {(index.data?.overlays ?? 0) > 0 ? ` · ${fmtInt(index.data?.overlays)} carry your organisation's note` : ""}
        </p>
      </header>

      {shown === 0 && (
        <Card>
          <p className="reading text-sm text-text-muted">No page carries that word. Try a shorter one, or the name of a stage.</p>
        </Card>
      )}

      {KIND_ORDER.filter((k) => byKind.get(k)?.length).map((kind) => {
        const nodes = byKind.get(kind) ?? [];
        return (
          <Card key={kind} data-testid={`hub-group-${kind}`}>
            <CardTitle>
              {KIND_WORDS[kind] ?? kind}
              <span className="ml-2 text-xs font-normal text-text-subtle">{fmtInt(nodes.length)}</span>
            </CardTitle>
            <ul className={cn("grid gap-x-4 gap-y-1", nodes.length > 6 ? "sm:grid-cols-2 xl:grid-cols-3" : "")}>
              {nodes.map((n) => (
                <li key={n.id} className="min-w-0">
                  <Link
                    to="/p/$projectId/knowledge/$nodeId"
                    params={{ projectId: ctx.projectId, nodeId: n.id }}
                    className="flex min-w-0 items-baseline gap-2 rounded-sm py-0.5 text-sm text-accent-text hover:underline"
                    title={n.method_name ?? undefined}
                  >
                    <span className="truncate">{nameOf(n)}</span>
                    {n.hasOverlay && (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        your note
                      </Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
