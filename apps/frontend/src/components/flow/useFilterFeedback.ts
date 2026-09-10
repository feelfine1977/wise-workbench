/**
 * Never silent (§2.4): every filter change reports in the same three places within a second — the count
 * line, a chip, and one sentence in the live region. This hook watches the screen's filter and the count
 * that comes back for it, and says what happened, including the case the owner hit twice: an action that
 * removes no item still produces a chip, and the count line says *no items removed* for two seconds.
 */
import { useEffect, useRef, useState } from "react";
import type { Filter, FilterClause } from "@/lib/api/filter-types";
import { addedClauses, announceFilter, removedClauses, serializeFilter } from "@/lib/filter";

export interface FilterFeedback {
  /** The sentence for the live region, or undefined when nothing has changed yet. */
  announcement?: string;
  /** True for two seconds after an action that kept every item. */
  noneRemoved: boolean;
}

export function useFilterFeedback(input: {
  filter: Filter | undefined;
  /** The result of the whole filter; undefined while it is being counted. */
  casesIn: number | undefined;
  casesTotal: number | undefined;
  noun: string;
  /** How many panels answered the click (the board says so). */
  panels?: number;
  labelOf?: (id: string) => string;
}): FilterFeedback {
  const { filter, casesIn, casesTotal, noun, panels, labelOf } = input;
  const key = serializeFilter(filter) ?? "";
  const last = useRef<{ key: string; casesIn?: number; filter?: Filter }>({ key, casesIn, filter });
  const [pending, setPending] = useState<{ key: string; added: FilterClause[]; removed: FilterClause[]; before?: number }>();
  const [feedback, setFeedback] = useState<FilterFeedback>({ noneRemoved: false });

  useEffect(() => {
    if (key === last.current.key) {
      if (casesIn !== undefined) last.current.casesIn = casesIn;
      return;
    }
    setPending({ key, added: addedClauses(last.current.filter, filter), removed: removedClauses(last.current.filter, filter), before: last.current.casesIn });
    last.current = { key, casesIn: undefined, filter };
  }, [key, filter, casesIn]);

  useEffect(() => {
    if (!pending || pending.key !== key || casesIn === undefined || casesTotal === undefined) return;
    const noneRemoved = pending.added.length > 0 && pending.before !== undefined && casesIn === pending.before;
    const announcement = announceFilter({ added: pending.added, removed: pending.removed }, { casesIn, casesTotal }, noun, { panels, labelOf, removedNone: noneRemoved });
    setFeedback({ announcement, noneRemoved });
    last.current = { key, casesIn, filter };
    setPending(undefined);
  }, [pending, key, casesIn, casesTotal, noun, panels, labelOf, filter]);

  useEffect(() => {
    if (!feedback.noneRemoved) return;
    const id = window.setTimeout(() => setFeedback((f) => ({ ...f, noneRemoved: false })), 2000);
    return () => window.clearTimeout(id);
  }, [feedback.noneRemoved]);

  return feedback;
}
