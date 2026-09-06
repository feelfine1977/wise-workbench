import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useWorkbench } from "@/app/context";
import { EmptyState, QueryState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle, Table, Td, Th } from "@/components/ui/misc";
import { fmtDateTime } from "@/lib/format";
import { normsQuery } from "@/lib/queries";

const statusVariant = { draft: "warning", reviewed: "info", approved: "success" } as const;
const statusGlyph = { draft: "◐", reviewed: "◑", approved: "●" } as const;

/** S3–S4 — norm versions. */
export default function NormsPage() {
  const { t } = useTranslation();
  const ctx = useWorkbench();
  const norms = useQuery(normsQuery(ctx.projectId));
  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-xs uppercase tracking-wide text-text-subtle">S3–S4 · Norm elicitation and view design</p>
        <h1 className="text-2xl font-semibold">Norm versions</h1>
        <p className="text-sm text-text-muted">Every save is an immutable version with a note. The builder forms arrive with increment 1; this screen shows the versions, their JSON and the calibration lens.</p>
      </header>
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
                    <Th>fingerprint</Th>
                    <Th>created</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...list]
                    .sort((a, b) => b.version - a.version)
                    .map((n) => (
                      <tr key={n.id} className={ctx.run?.normVersionId === n.id ? "bg-selection/40" : undefined}>
                        <Td>
                          <Link className="font-medium text-accent-text underline" to="/p/$projectId/norms/$normVersionId" params={{ projectId: ctx.projectId, normVersionId: n.id }} search={{ tab: "constraints" }}>
                            v{n.version}
                          </Link>
                          {ctx.run?.normVersionId === n.id && <span className="ml-2 text-xs text-text-subtle">used by {ctx.run.id}</span>}
                        </Td>
                        <Td>
                          <Badge variant={statusVariant[n.status]}>
                            <span aria-hidden>{statusGlyph[n.status]}</span>
                            {n.status}
                          </Badge>
                        </Td>
                        <Td className="max-w-lg">{n.note}</Td>
                        <Td>{n.author}</Td>
                        <Td className="font-mono text-xs">{n.fingerprint}</Td>
                        <Td>{fmtDateTime(n.createdAt)}</Td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            </Card>
          )
        }
      </QueryState>
    </div>
  );
}
