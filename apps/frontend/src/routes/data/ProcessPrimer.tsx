import { useId, useState } from "react";
import { viewColor } from "@/lib/viewColors";
import { PROCESS_PRIMER_METHOD_SOURCES, PROCESS_PRIMER_PROFILES, resolveProcessPrimer, type PrimerSource, type ProcessPrimerId, type ProcessPrimerProfile } from "./processPrimerProfiles";

export interface ProcessPrimerProps {
  /** Authoritative process label for this dataset, not event data or an inherited project assumption. */
  process?: string;
}

const summaryClass = "cursor-pointer rounded-sm py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const linkClass = "text-accent-text underline underline-offset-2";

/** Parent owns placement and metadata selection. No router, requests, stores or norm mutations. */
export function ProcessPrimer({ process }: ProcessPrimerProps) {
  // Reset local example choices and native disclosures when the metadata label changes.
  return <PrimerContent key={process ?? ""} process={process} />;
}

function PrimerContent({ process }: ProcessPrimerProps) {
  const id = useId();
  const suggested = resolveProcessPrimer(process);
  const [choice, setChoice] = useState<ProcessPrimerId | "">(() => suggested?.id ?? "");
  const profile = choice ? PROCESS_PRIMER_PROFILES[choice] : undefined;
  const label = process?.trim();
  const selectionNote = !profile
    ? suggested
      ? "Choose an example to explore."
      : label
        ? `No matching guide for “${label}”. Choose an example to explore; this does not classify your data.`
        : "No process label supplied. Choose an example to explore; this does not classify your data."
    : suggested?.id === choice
      ? `Guide suggested by the process label “${label}”. You can explore another example.`
      : "You selected this example. Your process metadata and loaded data are unchanged.";

  return (
    <section aria-labelledby={`${id}-heading`} aria-describedby={`${id}-scope`} className="min-w-0 rounded-md border border-border bg-surface p-4 text-text sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Process understanding</p>
          <h2 id={`${id}-heading`} className="mt-1 text-lg font-semibold">{profile?.name ?? "Explore a typical process"}</h2>
        </div>
        <div className="w-full sm:w-auto">
          <label htmlFor={`${id}-choice`} className="mb-1 block text-xs font-medium">Example process</label>
          <select
            id={`${id}-choice`}
            value={choice}
            aria-describedby={`${id}-selection`}
            className="min-h-10 w-full max-w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:w-52"
            onChange={(event) => setChoice(event.target.value as ProcessPrimerId | "")}
          >
            <option value="">Choose an example…</option>
            {Object.values(PROCESS_PRIMER_PROFILES).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
      </header>

      <p id={`${id}-scope`} className="mt-3 text-sm font-medium text-accent-text">Illustrative guide · not mined from your loaded log.</p>
      <p id={`${id}-selection`} role="status" className="mt-1 break-words text-xs text-text-muted">{selectionNote}</p>

      {profile && (
        <div key={profile.id} className="mt-3">
          <p className="max-w-prose text-sm">{profile.purpose}</p>
          <section aria-labelledby={`${id}-perspectives`} className="mt-4">
            <h3 id={`${id}-perspectives`} className="text-xs font-medium text-text-muted">Stakeholder perspectives · illustrative goals, not scores</h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {profile.perspectives.map((perspective) => (
                <li key={perspective.name} className="rounded-md border border-border border-t-2 p-3 text-sm" style={{ borderTopColor: viewColor(perspective.name) }}>
                  <h4 className="font-semibold">{perspective.name}</h4>
                  <p className="mt-1">{perspective.goal}</p>
                  <p className="mt-2 text-xs text-text-muted"><span className="font-medium">Expectation: </span>{perspective.expectation}</p>
                </li>
              ))}
            </ul>
          </section>
          <StageFigure profile={profile} id={`${id}-stages`} />

          <div className="mt-4 divide-y divide-border border-t border-border">
            <details>
              <summary className={summaryClass}>People, handoffs and expectations</summary>
              <div className="space-y-4 pb-4">
                <HandoffFigure profile={profile} id={`${id}-handoffs`} />
                <div>
                  <h3 className="text-sm font-semibold">Main expectations · illustrative targets to agree locally</h3>
                  <ul className="mt-2 grid gap-3 md:grid-cols-3">
                    {profile.expectations.map((item) => (
                      <li key={item.name} className="border-l-2 border-accent pl-3 text-sm">
                        <p className="font-medium">{item.name}</p>
                        <p className="mt-1 text-text-muted">{item.description}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-text-muted">These are discussion prompts, not configured constraints or universal thresholds.</p>
                </div>
              </div>
            </details>

            <details>
              <summary className={summaryClass}>Common problems and evidence to check</summary>
              <EvidenceFigure profile={profile} id={`${id}-evidence`} />
            </details>

            <details>
              <summary className={summaryClass}>Use this understanding in Workbench</summary>
              <div className="space-y-3 pb-4 text-sm">
                <p className="max-w-prose">Agree the process boundary with the people doing the work. Validate event meanings and coverage before judging performance.</p>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Process norm", "The versioned expectations, applicability and scoring choices used for an assessment."],
                    ["View", "A stakeholder perspective that weights the norm’s layers and constraints."],
                    ["Layer", "A group of related expectations, such as timeliness or document consistency."],
                    ["Constraint", "One testable expectation, with an explicit rule and scope of applicability."],
                  ].map(([term, description]) => (
                    <div key={term} className="rounded-md bg-surface-sunken p-3">
                      <dt className="font-medium">{term}</dt>
                      <dd className="mt-1 text-text-muted">{description}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-text-muted">This guide does not create a Process norm. Agree any targets, tolerances and exceptions with the process owner; observed results require mapped data and an assessment.</p>
              </div>
            </details>

            <details>
              <summary className={summaryClass}>Process variants and official sources</summary>
              <div className="space-y-3 pb-1 text-sm">
                <p className="max-w-prose">{profile.variants}</p>
                <p className="max-w-prose text-text-muted">The stages draw on the sources below. Team groupings, expectations and evidence questions are illustrative practitioner guidance; no problem, frequency or cause is asserted for your log.</p>
                <SourceList sources={profile.sources} />
                <h3 className="pt-1 text-sm font-semibold">How to use the guide</h3>
                <SourceList sources={PROCESS_PRIMER_METHOD_SOURCES} />
              </div>
            </details>
          </div>
        </div>
      )}
    </section>
  );
}

function StageFigure({ profile, id }: { profile: ProcessPrimerProfile; id: string }) {
  return (
    <figure aria-labelledby={id} className="mt-4">
      <figcaption id={id} className="text-xs font-medium text-text-muted">Typical stages · illustrative sequence</figcaption>
      <ol className="mt-2 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {profile.stages.map((stage, index) => (
          <li key={stage.name} className="flex min-w-0 gap-2 rounded-md border border-border bg-surface-sunken p-3 sm:flex-col">
            <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong text-xs font-semibold text-text-muted">{index + 1}</span>
            <div>
              <p className="text-sm font-medium">{stage.name}</p>
              <p className="mt-1 text-xs text-text-muted">{stage.team}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-text-muted">{profile.boundary} Paths and responsibilities vary.</p>
      <p className="mt-1 text-xs text-text-muted">Stage reference: <a className={linkClass} href={profile.sources[0]?.url}>{profile.sources[0]?.title}</a>.</p>
    </figure>
  );
}

function HandoffFigure({ profile, id }: { profile: ProcessPrimerProfile; id: string }) {
  return (
    <figure aria-labelledby={id}>
      <figcaption id={id} className="text-xs font-medium text-text-muted">Handoffs and value · illustrative responsibilities</figcaption>
      <ul className="mt-2 grid gap-2 md:grid-cols-3">
        {profile.handoffs.map((handoff) => (
          <li key={handoff.from} className="min-w-0 rounded-md border border-border p-3 text-sm">
            <p className="font-medium">{handoff.from}</p>
            <div className="my-2 flex items-center gap-2 text-accent-text">
              <svg aria-hidden="true" focusable="false" viewBox="0 0 20 24" className="h-6 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M10 2v18m-5-5 5 5 5-5" />
              </svg>
              <span className="text-xs">{handoff.pass}</span>
            </div>
            <p className="font-medium"><span className="sr-only">To </span>{handoff.to}</p>
            <p className="mt-2 border-t border-border pt-2 text-xs text-text-muted">Value: {handoff.value}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-text-muted">Confirm local owners, including the supplier or customer. A handoff in this guide does not prove a delay.</p>
    </figure>
  );
}

function EvidenceFigure({ profile, id }: { profile: ProcessPrimerProfile; id: string }) {
  return (
    <figure aria-labelledby={id} className="pb-4">
      <figcaption id={id} className="text-xs font-medium text-text-muted">Problem-to-evidence map · questions, not findings</figcaption>
      <ul className="mt-2 grid gap-2 md:grid-cols-3">
        {profile.problems.map((problem) => (
          <li key={problem.name} className="rounded-md border border-border p-3 text-sm">
            <h3 className="font-semibold">{problem.name}</h3>
            <dl className="mt-3 space-y-2">
              <div>
                <dt className="text-xs font-medium text-accent-text">Evidence to check</dt>
                <dd className="mt-1">{problem.evidence}</dd>
              </div>
              <div className="border-t border-border pt-2">
                <dt className="text-xs font-medium text-text-muted">Before concluding</dt>
                <dd className="mt-1 text-text-muted">{problem.caution}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <p className="mt-2 max-w-prose text-xs text-text-muted">Check case links, missing events and timestamp meanings first. Elapsed time between recorded events is not a direct measure of waiting or working time. Discuss candidate explanations with process participants before testing a change.</p>
    </figure>
  );
}

function SourceList({ sources }: { sources: readonly PrimerSource[] }) {
  return (
    <ul className="space-y-2">
      {sources.map((source) => (
        <li key={source.url}>
          <a className={linkClass} href={source.url}>{source.title}</a>
          <p className="mt-0.5 text-xs text-text-muted">{source.supports}</p>
        </li>
      ))}
    </ul>
  );
}
