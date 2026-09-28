import { queryOptions } from "@tanstack/react-query";
import type { components } from "@wise/api-schema";
import { http } from "./transport";

export type NormTemplateCatalogue = components["schemas"]["NormTemplateCatalogue"];

export const normTemplatesQuery = (projectId: string, caseTableId: string, labelPack?: string, templateId?: string) => queryOptions({
  queryKey: ["projects", projectId, "norm-templates", caseTableId, labelPack ?? "", templateId ?? ""] as const,
  queryFn: async () => {
    const value = await http.get<NormTemplateCatalogue>(
      `/projects/${encodeURIComponent(projectId)}/norms/templates`, { caseTableId, labelPack: labelPack || undefined, templateId: templateId || undefined },
    );
    if (value.projectId !== projectId || value.caseTableId !== caseTableId || value.labelPack !== (labelPack || null) || value.templateId !== (templateId || null)) {
      throw new Error("The template preview does not match the selected project and preparation.");
    }
    return value;
  },
  enabled: !!projectId && !!caseTableId,
  staleTime: 0,
  retry: false,
});
