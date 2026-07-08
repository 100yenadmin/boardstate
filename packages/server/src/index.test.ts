import { describe, expect, it } from "vitest";
import { BOARDSTATE_PACKAGE } from "./index.js";

describe("@boardstate/server", () => {
  it("exports the package name placeholder", () => {
    expect(BOARDSTATE_PACKAGE).toBe("@boardstate/server");
  });
});
