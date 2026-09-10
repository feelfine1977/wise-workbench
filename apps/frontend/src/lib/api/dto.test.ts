import { expectTypeOf, it } from "vitest";
import type { components } from "@wise/api-schema";
import type { Driver, WhatCanWeDo } from "./review";
import type { Guidance, HubPage } from "./knowledge";
import type { ConstraintCheck } from "./norms";
import type { RunWithScope } from "./runs";
import type { BacklogRow, SliceDetail } from "./exploration";
import type { Facets, Kpis } from "./board";

type S = components["schemas"];
it("derives named wire fields from generated DTOs, keeping open content refinements explicit", () => {
  expectTypeOf<Pick<Driver, "constraint_id" | "comparison" | "headroom_points">>().toEqualTypeOf<Pick<S["WhatCanWeDoDriver"], "constraint_id" | "comparison" | "headroom_points">>();
  expectTypeOf<Omit<WhatCanWeDo, "drivers">>().toEqualTypeOf<Omit<S["WhatCanWeDo"], "drivers">>();
  expectTypeOf<Omit<Guidance, "generic" | "overlay">>().toEqualTypeOf<Omit<S["Guidance"], "generic" | "overlay">>();
  expectTypeOf<Omit<HubPage, "node" | "guidance" | "related" | "overlay">>().toEqualTypeOf<Omit<S["HubPage"], "node" | "guidance" | "related" | "overlay">>();
  expectTypeOf<Omit<ConstraintCheck, "errors" | "activities">>().toEqualTypeOf<Omit<S["ConstraintCheck"], "errors" | "activities">>();
  expectTypeOf<RunWithScope["scope"]>().toEqualTypeOf<S["RunScope"] | null | undefined>();
  expectTypeOf<BacklogRow>().toEqualTypeOf<S["BacklogRow"]>();
  expectTypeOf<SliceDetail>().toEqualTypeOf<S["SliceDetail"]>();
  expectTypeOf<Facets>().toExtend<S["Facets"]>();
  expectTypeOf<Kpis>().toExtend<S["Kpis"]>();
});
