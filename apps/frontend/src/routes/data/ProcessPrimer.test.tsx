import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { ProcessPrimer } from "./ProcessPrimer";
import { viewColor } from "@/lib/viewColors";

describe("ProcessPrimer", () => {
  it("offers a choice for another BPIC process instead of silently showing procurement", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    render(<ProcessPrimer process="BPIC2017" />);

    expect(screen.getByRole("combobox", { name: "Example process" })).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("No matching guide for “BPIC2017”");
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "o2c");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Order-to-cash (O2C)");
    expect(screen.getByRole("status")).toHaveTextContent("Your process metadata and loaded data are unchanged");
    expect(screen.getByText("Illustrative guide · not mined from your loaded log.")).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("has no implicit default when metadata is absent", () => {
    render(<ProcessPrimer />);
    expect(screen.getByRole("status")).toHaveTextContent("No process label supplied");
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });

  it.each(["p2p", "o2c"])("introduces four stakeholder goals before disclosure for %s, without scores or a view switcher", (process) => {
    render(<ProcessPrimer process={process} />);
    const perspectives = screen.getByRole("region", { name: "Stakeholder perspectives · illustrative goals, not scores" });
    for (const name of ["Finance", "Logistics", "Compliance", "Automation"]) {
      const heading = within(perspectives).getByRole("heading", { name });
      expect(heading).toBeVisible();
      expect(heading.closest("details")).toBeNull();
      expect(heading.closest("li")).toHaveTextContent("Expectation:");
      expect(heading.closest("li")).toHaveStyle({ borderTopColor: viewColor(name) });
    }
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(perspectives).queryByRole("button")).not.toBeInTheDocument();
    expect(within(perspectives).queryByRole("tab")).not.toBeInTheDocument();
  });

  it("distinguishes the illustrative path, expectations and investigation questions from observations", async () => {
    const user = userEvent.setup();
    render(<ProcessPrimer process="bpic2019" />);
    expect(screen.getByText("Illustrative guide · not mined from your loaded log.")).toBeVisible();
    const stages = screen.getByRole("figure", { name: "Typical stages · illustrative sequence" });
    expect(stages).toHaveTextContent("Requesting department");
    expect(stages).toHaveTextContent("Pay & clear");
    expect(stages).toHaveTextContent("order, an item or an invoice");

    const people = screen.getByText("People, handoffs and expectations");
    expect(people.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("figure", { name: /Handoffs and value/ })).not.toBeVisible();
    await user.click(people);
    expect(screen.getByRole("figure", { name: /Handoffs and value/ })).toHaveTextContent("Approved invoice and payment terms");
    expect(screen.getByRole("heading", { name: /illustrative targets to agree locally/ })).toBeVisible();
    expect(screen.getByText(/not configured constraints or universal thresholds/)).toBeVisible();

    await user.click(screen.getByText("Common problems and evidence to check"));
    const evidence = screen.getByRole("figure", { name: "Problem-to-evidence map · questions, not findings" });
    expect(evidence).toHaveTextContent("A block may be a valid control");
    expect(evidence).toHaveTextContent("does not establish lateness or its cause");
    expect(evidence).toHaveTextContent("not a direct measure of waiting or working time");

    await user.click(screen.getByText("Process variants and official sources"));
    expect(screen.getByText(/two-way matching without a required receipt/)).toBeVisible();
    expect(screen.getByRole("link", { name: "IEEE Task Force · BPI Challenge 2019" })).toHaveAttribute("href", "https://tfpm.compute.dtu.dk/competitions-awards/bpi-challenge/2019");
  });

  it("switches example content and resets disclosures without carrying P2P evidence into O2C", async () => {
    const user = userEvent.setup();
    render(<ProcessPrimer process="p2p" />);
    await user.click(screen.getByText("Common problems and evidence to check"));
    expect(screen.getByRole("heading", { name: "Invoice blocked or mismatched" })).toBeVisible();

    await user.selectOptions(screen.getByRole("combobox"), "o2c");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Order-to-cash (O2C)");
    expect(screen.getByRole("figure", { name: /Typical stages/ })).toHaveTextContent("Apply cash");
    expect(screen.getByText("Common problems and evidence to check").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText("Invoice blocked or mismatched")).not.toBeInTheDocument();
    await user.click(screen.getByText("Common problems and evidence to check"));
    expect(screen.getByRole("figure", { name: /Problem-to-evidence/ })).toHaveTextContent("not proof the customer has not paid");

    await user.selectOptions(screen.getByRole("combobox"), "");
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });

  it("follows metadata changes and discards a manual choice when the process changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ProcessPrimer process="p2p" />);
    rerender(<ProcessPrimer process="o2c" />);
    expect(screen.getByRole("combobox")).toHaveValue("o2c");
    rerender(<ProcessPrimer process="loan application" />);
    expect(screen.getByRole("combobox")).toHaveValue("");
    await user.selectOptions(screen.getByRole("combobox"), "p2p");
    rerender(<ProcessPrimer process="incident management" />);
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    rerender(<ProcessPrimer process="purchase-to-pay" />);
    expect(screen.getByRole("combobox")).toHaveValue("p2p");
  });

  it("uses Workbench terms and keeps the primer separate from norm configuration", async () => {
    const user = userEvent.setup();
    render(<ProcessPrimer process="o2c" />);
    await user.click(screen.getByText("Use this understanding in Workbench"));
    for (const term of ["Process norm", "View", "Layer", "Constraint"]) {
      expect(screen.getByText(term, { selector: "dt" })).toBeVisible();
    }
    expect(screen.getByText(/This guide does not create a Process norm/)).toBeVisible();
  });

  it("provides keyboard focus for the process choice and native disclosures", async () => {
    const user = userEvent.setup();
    render(<ProcessPrimer process="p2p" />);
    await user.tab();
    expect(screen.getByRole("combobox")).toHaveFocus();
    await user.tab();
    expect(within(screen.getByRole("figure", { name: /Typical stages/ })).getByRole("link", { name: "SAP · Purchase order lifecycle" })).toHaveFocus();
    await user.tab();
    const summary = screen.getByText("People, handoffs and expectations");
    expect(summary).toHaveFocus();
    // jsdom omits the native summary keyboard activation; a real-browser check covers Enter / Space.
    await user.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
  });

  it.each([undefined, "p2p", "o2c"])("has no axe violations in its available disclosures for %s", async (process) => {
    const user = userEvent.setup();
    const { container } = render(<ProcessPrimer process={process} />);
    if (process) {
      for (const summary of container.querySelectorAll("summary")) await user.click(summary);
      expect(screen.getAllByRole("figure")).toHaveLength(3);
    }
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map(({ id, nodes }) => ({ id, elements: nodes.map((node) => node.html) }))).toEqual([]);
  });

  it("keeps labels and figure descriptions unique when two primers are mounted", () => {
    const { container } = render(<><ProcessPrimer process="p2p" /><ProcessPrimer process="o2c" /></>);
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(screen.getAllByRole("combobox", { name: "Example process" })).toHaveLength(2);
  });
});
