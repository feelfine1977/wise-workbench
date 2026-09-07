/**
 * R3-13 — no release name, no stage code, no raw id as a primary label.
 *
 * Every screen of the analysis path is rendered on the verified run and its **visible** text is read: the
 * text of the elements a reader sees, without the accessible names, titles and `data-` attributes that carry
 * the method's own identifiers on purpose. The sweep looks for the five things cycle 3 found on the screens:
 *
 * - a cycle or an increment named in the product (*the builder forms arrive with increment 1*);
 * - a stage code of the process the panel follows (*S3–S4 · NORM ELICITATION AND VIEW DESIGN*);
 * - a fingerprint or a content hash printed as a column of a table rather than kept under *details*;
 * - a raw identifier as a primary label (`c_l3_invoice_to_clear_days`, `run_0mtoq44…`, `case Company`);
 * - the word *cases* on a run whose mapping has set a noun of its own (*purchase order items*).
 *
 * Where a method term is the point of the screen the reader asked for it — the words switch set to *method*,
 * the *details* block of a run — the sweep does not run; those are the two places the identifiers belong.
 */
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";

const T = { timeout: 8000 };
const RUN = "/p/p2p2018/runs/run_41";
const CSA = encodeURIComponent("case Company+case Spend area text");
const PACKAGING = encodeURIComponent('["companyID_0000", "Packaging"]');

/**
 * What a reader sees: the rendered text of the screen, with the blocks a reader has to open left out — a
 * *Technical details* disclosure is where the identifiers belong, and the sweep is about what is printed
 * before anyone asks.
 */
function visibleText(root: HTMLElement = document.body): string {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll("details")) {
    const summary = el.querySelector("summary");
    el.replaceWith(summary ?? document.createTextNode(""));
  }
  for (const el of clone.querySelectorAll("[hidden], [aria-hidden='true'], .sr-only")) el.remove();
  return (clone.textContent ?? "").replace(/\s+/g, " ");
}

const RULES: { name: string; pattern: RegExp }[] = [
  { name: "a cycle or an increment of the work", pattern: /\b(increment|cycle)\s*\d/i },
  { name: "a stage code of the panel's process", pattern: /\bS\d+\s*[–-]\s*S\d+\b/ },
  { name: "a fingerprint or a content hash", pattern: /\b(fingerprint|content hash)\b/i },
  { name: "a raw identifier", pattern: /\b(?:c_l\d|a_[a-z]+_|run_[a-z0-9]{6}|nv_\d|ct_[a-z0-9]{2}|ds_\d|L\d_[a-z])/ },
  { name: "a column name as a label", pattern: /\bcase [A-Z]/ },
  // the sweep of cycle 4: what the screens outside the analysis path were still printing
  { name: "a plural in brackets", pattern: /\b[a-z]+\(s\)/i },
  { name: "a machine stamp", pattern: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/ },
  { name: "a path in the repository", pattern: /\b[\w/-]+\.(md|ya?ml|json|py|tsx?)\b/ },
  { name: "a pack id", pattern: /\b(?:p2p|o2c)(?:\.[a-z_.]+)?\b/ },
  { name: "a field name", pattern: /\b[a-z]+_[a-z_]+\b/ },
];

/** Every rule, on one screen; the word *cases* is checked separately because the run's noun decides it. */
function expectPlainWords(where: string, text: string) {
  for (const rule of RULES) {
    const hit = rule.pattern.exec(text);
    expect(hit?.[0], `${where} prints ${rule.name}: “${hit?.[0] ?? ""}”`).toBeUndefined();
  }
}

describe("no release name, no stage code, no raw id as a primary label (R3-13)", () => {
  it("the ranked list of a run whose mapping names its cases", async () => {
    renderApp(`${RUN}/backlog?slicing=${CSA}&view=Automation`);
    await screen.findByRole("list", { name: "Signals" }, T);
    const text = visibleText();
    expectPlainWords("the ranked list", text);
    // the run's own noun replaces "cases" wherever the mapping has set one
    expect(text).toMatch(/purchase order items/);
    expect(/\bcases\b/.exec(text)?.[0], "the ranked list still says “cases” on a run whose noun is “purchase order items”").toBeUndefined();
  });

  it("the reason screen", async () => {
    renderApp(`${RUN}/slices/${PACKAGING}?slicing=${CSA}&view=Automation&tab=why`);
    await screen.findByTestId("why-strip", {}, T);
    expectPlainWords("the reason screen", visibleText());
  });

  it("the run screen", async () => {
    renderApp(RUN);
    await screen.findByRole("heading", { level: 1 }, T);
    const text = visibleText();
    expectPlainWords("the run screen", text);
    expect(text).toMatch(/purchase order items scored against the norm/);
  });

  it("the datasets table", async () => {
    renderApp("/p/p2p2018/data");
    await screen.findByText("Datasets", {}, T);
    const table = screen.getAllByRole("table")[0] as HTMLElement;
    expectPlainWords("the datasets table", visibleText(table));
  });

  it("the norm screen", async () => {
    renderApp("/p/p2p2018/norms/nv_7?tab=constraints");
    await screen.findByTestId("norm-builder", {}, T);
    const text = visibleText();
    for (const rule of RULES.filter((r) => r.name !== "a raw identifier")) {
      const hit = rule.pattern.exec(text);
      expect(hit?.[0], `the norm screen prints ${rule.name}: “${hit?.[0] ?? ""}”`).toBeUndefined();
    }
  });

  it("the data screen and its readiness decisions", async () => {
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1");
    await screen.findByRole("heading", { level: 1 }, T);
    expectPlainWords("the data screen", visibleText());
  });

  it("the dashboard", async () => {
    renderApp("/p/p2p2018");
    await screen.findByRole("heading", { level: 1 }, T);
    expectPlainWords("the dashboard", visibleText());
  });

  it("the knowledge hub, its index and a page", async () => {
    renderApp("/p/p2p2018/knowledge");
    await screen.findByText(/What the words mean/, {}, T);
    expectPlainWords("the hub index", visibleText());

    cleanup();
    renderApp(`/p/p2p2018/knowledge/${encodeURIComponent("expectation:p2p_bpic19:c_l3_invoice_to_clear_days")}`);
    await screen.findAllByText(/Paid within terms/, {}, T);
    const page = visibleText();
    expectPlainWords("the hub page", page);
    // the page carries the pack's own knowledge, and the pack's sources are not the reader's business
    expect(page).toMatch(/Paid within terms/);
  });

  it("the states that end, where a link carries a filter the run cannot read", async () => {
    const unknown = encodeURIComponent(JSON.stringify({ and: [{ kind: "resource_pool", pool: "night shift" }] }));
    renderApp(`${RUN}/flow?slicing=${CSA}&view=Automation&filter=${unknown}`);
    await screen.findByRole("alert", {}, T);
    const text = visibleText();
    expectPlainWords("the Flow step's error state", text);
    // and no count where there is nothing to count: it read "all flows · – cases"
    expect(/–\s*cases|\bcases\b/.exec(text)?.[0], "the error state still says “cases” on a run whose noun is “purchase order items”").toBeUndefined();
  });

  it("keeps the identifiers where a reader asks for them: the run's technical details", async () => {
    const user = userEvent.setup();
    renderApp(`${RUN}?tab=monitor`);
    const details = (await screen.findByTestId("run-technical", {}, T)) as HTMLDetailsElement;
    // jsdom does not toggle a disclosure on a click, so it is opened the way the browser would
    await user.click(within(details).getByText("Technical details"));
    details.open = true;
    // this is the one place the fingerprint and the hashes belong, and they are still there
    expect(within(details).getAllByText(/norm fingerprint/i).length).toBeGreaterThan(0);
    expect(within(details).getAllByText(/content hash/i).length).toBeGreaterThan(0);
  });
});
