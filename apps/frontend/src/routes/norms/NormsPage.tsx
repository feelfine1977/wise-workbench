import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useWorkbench } from "@/app/context";
import { EmptyState, QueryState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, Table, Td, Th } from "@/components/ui/misc";
import { fmtDateTime } from "@/lib/format";
import { normsQuery } from "@/lib/queries";
import { StartNormDialog } from "./StartNormDialog";
import { NEXT_STATUS, SignVersion } from "./SignVersion";

const statusVariant = { draft: "warning", reviewed: "info", approved: "success" } as const;
const statusGlyph = { draft: "◐", reviewed: "◑", approved: "●" } as const;
/** The versions of this project's norm: what changed, who signed it, and which one the latest run used. */
export default function NormsPage() {
  const { t } = useTranslation();
  const ctx = useWorkbench();
  const navigate = useNavigate();
  const norms = useQuery(normsQuery(ctx.projectId));
  const [signing, setSigning] = useState<string>();
  const version = (norms.data ?? []).find((n) => n.id === signing);
  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-xs uppercase tracking-wide text-text-subtle">Process norm</p>
        <h1 className="text-2xl font-semibold">Process norm versions</h1>
        <p className="reading max-w-prose text-sm text-text-muted">
          Start from a business question, then decide which expectations the data can check. Choose an existing norm or begin with one expectation.
        </p>
      </header>
      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="font-semibold">Choose your starting point</h2><p className="mt-1 max-w-prose text-sm text-text-muted">New process: start small. Existing expertise: open a version to edit its rules. Reassessment: open the previous norm and record what changed in its guided overview.</p></div>
        <div className="flex flex-wrap gap-2">
          {ctx.norm && <Link className="rounded border border-border px-3 py-2 text-sm font-medium text-accent-text" to="/p/$projectId/norms/$normVersionId" params={{ projectId: ctx.projectId, normVersionId: ctx.norm.id }} search={{ caseTable: ctx.caseTable?.id, tab: "guide" }}>Open guided overview</Link>}
          <StartNormDialog projectId={ctx.projectId} caseTableId={ctx.caseTable?.id} datasetName={ctx.dataset?.name} onCreated={id => void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: ctx.projectId, normVersionId: id }, search: { caseTable: ctx.caseTable?.id, tab: "guide" } })} />
        </div>
      </Card>
      <QueryState query={norms}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title={t("empty.noNorms")} reason={t("empty.noNormsReason")} />
          ) : (
            <Card>
              <CardTitle>Versions</CardTitle>
              <Table>
                <thead>
                  <tr>
                    <Th>version</Th>
                    <Th>status</Th>
                    <Th>note</Th>
                    <Th>author</Th>
                    <Th>created</Th>
                    <Th>sign</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...list]
                    .sort((a, b) => b.version - a.version)
                    .map((n) => (
                      <tr key={n.id} className={ctx.run?.normVersionId === n.id ? "bg-selection/40" : undefined}>
                        <Td>
                          <Link className="font-medium text-accent-text underline" to="/p/$projectId/norms/$normVersionId" params={{ projectId: ctx.projectId, normVersionId: n.id }} search={{ caseTable: ctx.caseTable?.id, tab: "guide" }}>
                            v{n.version}
                          </Link>
                          {ctx.run?.normVersionId === n.id && <span className="ml-2 text-xs text-text-subtle">the version the latest run was scored against</span>}
                        </Td>
                        <Td>
                          <Badge variant={statusVariant[n.status]}>
                            <span aria-hidden>{statusGlyph[n.status]}</span>
                            {n.status}
                          </Badge>
                        </Td>
                        <Td className="max-w-lg">{n.note}</Td>
                        <Td>{n.author}</Td>
                        <Td>{fmtDateTime(n.createdAt)}</Td>
                        <Td>
                          {/* P1-9: the endpoint that moves a version along has a control beside the badge */}
                          {NEXT_STATUS[n.status as "draft" | "reviewed"] ? (
                            <Button variant="outline" size="sm" onClick={() => setSigning(n.id)}>
                              {NEXT_STATUS[n.status as "draft" | "reviewed"].label}
                            </Button>
                          ) : (
                            <span className="text-xs text-text-subtle">signed</span>
                          )}
                        </Td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            </Card>
          )
        }
      </QueryState>
      {version && <SignVersion projectId={ctx.projectId} key={version.id} version={version} onDone={createdId => { setSigning(undefined); if (createdId) void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: ctx.projectId, normVersionId: createdId }, search: { tab: "review" } }); }} />}
    </div>
  );
}
