import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { normQuery, runQuery } from "./queries";

/** Resolve display names from the norm pinned to the trace's assessment. */
export function useRunConstraintNames(projectId: string, runId: string, enabled: boolean) {
  const run = useQuery({ ...runQuery(projectId, runId), enabled });
  const normId = run.data?.normVersionId;
  const norm = useQuery({ ...normQuery(projectId, normId ?? ""), enabled: enabled && !!normId });
  return useMemo(() => {
    const document = norm.data?.norm as { constraints?: { id: string; plain_name?: string; description?: string }[] } | undefined;
    const names = new Map((document?.constraints ?? []).map(c => [c.id, c.plain_name?.trim() || c.description?.trim() || c.id]));
    return (id: string) => names.get(id) ?? id;
  }, [norm.data]);
}
