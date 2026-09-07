/**
 * One hub node as a page of its own (R3-05): the template of `knowledge_hub_panel.md` §3, with the way
 * back to the hub and the neighbours as links rather than as a panel's buttons.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useWorkbench } from "@/app/context";
import { hubNodeRoute } from "@/app/router";
import { hubPageQuery, notServed } from "@/lib/api/cycle4";
import { HubTemplate } from "@/components/knowledge/HubTemplate";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/states";
import { Card } from "@/components/ui/misc";

export default function HubNodePage() {
  const ctx = useWorkbench();
  const { nodeId } = hubNodeRoute.useParams();
  const navigate = useNavigate();
  const page = useQuery(hubPageQuery(ctx.projectId, nodeId));

  return (
    <div className="flex flex-col gap-4">
      <Link to="/p/$projectId/knowledge" params={{ projectId: ctx.projectId }} className="text-sm text-accent-text underline" data-testid="back-to-hub">
        ← Knowledge hub
      </Link>
      {page.isPending && <LoadingBlock rows={8} />}
      {page.isError &&
        (notServed(page.error) ? (
          <EmptyState
            title="There is no page for this word."
            reason="This project's process pack does not carry it. Search the hub for a word that is close to it."
            action={{ label: "Open the knowledge hub", to: "/p/$projectId/knowledge", params: { projectId: ctx.projectId } }}
          />
        ) : (
          <ErrorBlock error={page.error} retry={() => void page.refetch()} />
        ))}
      {page.data && (
        <Card className="max-w-[70ch]">
          <HubTemplate
            projectId={ctx.projectId}
            page={page.data}
            onOpen={(id) => void navigate({ to: "/p/$projectId/knowledge/$nodeId", params: { projectId: ctx.projectId, nodeId: id } })}
          />
        </Card>
      )}
    </div>
  );
}
