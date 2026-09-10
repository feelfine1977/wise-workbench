/** Feature API: filter-types. Generated DTOs remain the wire contract. */


export type TimeMode = "case_start" | "case_end" | "active" | "events_inside";

export interface TimeClause { kind: "time"; field?: TimeMode; from?: string; to?: string }

export interface AttributeClause { kind: "attribute"; field: string; in?: string[]; not_in?: string[]; range?: [number | null, number | null]; missing?: boolean }

export interface ActivityClause { kind: "activity"; op: "contains" | "not_contains" | "starts_with" | "ends_with" | "never"; activity: string }

export interface FollowsClause { kind: "follows"; a: string; b: string; directly?: boolean; never?: boolean }

export interface LagClause { kind: "lag"; a: string; b: string; unit?: "D" | "H" | "M" | "S"; min?: number; max?: number; directly?: boolean }

export interface CountClause { kind: "count"; activity: string; min?: number; max?: number }

export interface OpenClause { kind: "open"; value: boolean }

export interface ConstraintClause { kind: "constraint"; constraint: string; state: "violating" | "satisfied" | "in_scope" | "out_of_scope"; label?: string }

export interface SliceClause { kind: "slice"; slicing: string; key: unknown }

export interface AnyClause { kind: "any"; clauses: FilterClause[] }

export type FilterClause = TimeClause | AttributeClause | ActivityClause | FollowsClause | LagClause | CountClause | OpenClause | ConstraintClause | SliceClause | AnyClause;

export interface Filter { and: FilterClause[] }
