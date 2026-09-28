import { describe, expect, it } from "vitest";
import { resolveProcessPrimer } from "./processPrimerProfiles";

describe("process primer metadata selection", () => {
  it.each([
    "p2p", " P2P ", "purchase-to-pay", "Procure to Pay", "procure_to_pay", "Purchase–to–Pay",
    "Procure-to-pay (P2P)", "Purchase to pay (P2P)", "BPIC19", "bpic2019", "BPIC 2019", "BPI Challenge 2019", "BPI Challenge 2019 · Purchasing",
  ])("recognizes the explicit P2P label %s", (label) => {
    expect(resolveProcessPrimer(label)?.id).toBe("p2p");
  });

  it.each(["o2c", " O2C ", "order-to-cash", "Order to Cash", "order_to_cash", "Order–to–Cash (O2C)"])("recognizes the explicit O2C label %s", (label) => {
    expect(resolveProcessPrimer(label)?.id).toBe("o2c");
  });

  it.each([
    undefined, "", "   ", "BPIC", "BPIC2012", "BPIC2017", "BPIC2018", "BPIC2020", "BPIC20190",
    "BPI Challenge 2017", "BPI Challenge 2017 · Loan applications", "loan application", "incident management (VINST)", "travel declarations",
    "p2p / o2c", "o2c (sales side), p2p (purchase side), inventory", "unknown-p2p-process", "my-bpic2019.csv",
  ])("requires an explicit choice for absent, unsupported or ambiguous metadata: %s", (label) => {
    expect(resolveProcessPrimer(label)).toBeUndefined();
  });
});
