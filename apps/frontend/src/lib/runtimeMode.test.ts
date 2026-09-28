import { describe, expect, it } from "vitest";
import { runtimeMode } from "./runtimeMode";

describe("explicit fixture mode", () => {
  it.each([undefined, "production", "live", "development", "test"])("defaults %s to the live backend", MODE => {
    expect(runtimeMode({ MODE })).toEqual({ apiUrl: "", useMocks: false });
  });
  it("opts into demo mode without replacing an explicit backend", () => {
    expect(runtimeMode({ MODE: "demo" }).useMocks).toBe(true);
    expect(runtimeMode({ MODE: "demo", VITE_USE_MOCKS: "0" }).useMocks).toBe(false);
    expect(runtimeMode({ MODE: "demo", VITE_API_URL: " http://127.0.0.1:8018/ " })).toEqual({ apiUrl: "http://127.0.0.1:8018", useMocks: false });
  });
  it("honours explicit mocks for the isolated browser fixture tests", () => {
    expect(runtimeMode({ MODE: "production", VITE_USE_MOCKS: "1", VITE_API_URL: "http://127.0.0.1:8018" }).useMocks).toBe(true);
    expect(runtimeMode({ MODE: "production", VITE_USE_MOCKS: "", VITE_API_URL: "http://127.0.0.1:8018" }).useMocks).toBe(false);
    expect(runtimeMode({ MODE: "production", VITE_USE_MOCKS: "true" }).useMocks).toBe(false);
  });
});
