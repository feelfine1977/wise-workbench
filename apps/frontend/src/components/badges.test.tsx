import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/lib/stores/ui";
import { ConfidenceMark, GateBadge, HotspotBadge, KindBadge } from "./badges";

describe("badges never rely on colour alone", () => {
  beforeEach(() => useUiStore.getState().setVocabulary("plain"));

  it("kind badge shows a glyph, the plain kind and the method's name as a secondary label", () => {
    render(<KindBadge kind="acute" />);
    const badge = screen.getByText("acute").closest("[data-kind]");
    expect(badge).toHaveAttribute("data-kind", "acute");
    expect(badge).toHaveAttribute("data-hotspot", "severity");
    expect(badge?.textContent).toContain("▲");
    expect(screen.getByText("severity")).toBeInTheDocument();
  });
  it("the hotspot alias maps onto the kind, and the switch makes the method's name primary", () => {
    useUiStore.getState().setVocabulary("method");
    render(<HotspotBadge type="reservoir" />);
    const badge = screen.getByText("reservoir").closest("[data-kind]");
    expect(badge).toHaveAttribute("data-kind", "widespread");
    expect(badge?.textContent).toContain("●");
  });
  it("untyped groups say so", () => {
    render(<KindBadge kind={null} />);
    expect(screen.getByLabelText("no kind of problem yet")).toBeInTheDocument();
  });
  it("gate badges pair a glyph with the state", () => {
    render(<GateBadge state="waived" />);
    expect(screen.getByText("waived").parentElement?.textContent).toContain("⊘");
  });
  it("confidence marks carry screen-reader text", () => {
    render(<ConfidenceMark value="fragile" />);
    expect(screen.getByText("confidence medium")).toHaveClass("sr-only");
    expect(screen.getByText("●●○")).toHaveAttribute("aria-hidden", "true");
  });
});
