import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUiStore } from "@/lib/stores/ui";
import { definition, label, secondary, type Vocabulary } from "@/lib/vocabulary";
import { cn } from "@/lib/utils";

/** The current vocabulary and the label functions bound to it. */
export function useVocabulary() {
  const vocabulary = useUiStore((s) => s.vocabulary);
  const setVocabulary = useUiStore((s) => s.setVocabulary);
  return {
    vocabulary,
    setVocabulary,
    /** Primary label of a term. */
    t: (id: string) => label(id, vocabulary),
    /** The other vocabulary's label. */
    alt: (id: string) => secondary(id, vocabulary),
    def: (id: string) => definition(id),
  };
}

export interface TermProps {
  id: string;
  /** Override the primary text (e.g. a shorter column header) while keeping the secondary label and definition. */
  children?: ReactNode;
  /** Hide the muted secondary label. */
  primaryOnly?: boolean;
  className?: string;
  secondaryClassName?: string;
  vocabulary?: Vocabulary;
}

/**
 * A term in the current vocabulary: the primary label, then the other vocabulary's word as a muted
 * secondary label whose definition appears on hover and on focus.
 */
export function Term({ id, children, primaryOnly, className, secondaryClassName, vocabulary: forced }: TermProps) {
  const current = useUiStore((s) => s.vocabulary);
  const vocabulary = forced ?? current;
  const primary = children ?? label(id, vocabulary);
  const other = secondary(id, vocabulary);
  const def = definition(id);
  return (
    <span className={cn("inline-flex items-baseline gap-1", className)} data-term={id}>
      <span>{primary}</span>
      {!primaryOnly && other && other !== primary && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className={cn("cursor-help text-[11px] font-normal text-text-subtle", secondaryClassName)} aria-label={def ? `${other}: ${def}` : other}>
              {other}
            </span>
          </TooltipTrigger>
          {def && <TooltipContent>{def}</TooltipContent>}
        </Tooltip>
      )}
    </span>
  );
}
