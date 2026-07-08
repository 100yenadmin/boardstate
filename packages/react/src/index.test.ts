import { describe, expect, it } from "vitest";
import { BoardstateView } from "./index.js";

describe("@boardstate/react", () => {
  it("exports the BoardstateView component", () => {
    expect(typeof BoardstateView).toBe("function");
  });
});
