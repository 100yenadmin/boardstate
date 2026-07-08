import { describe, expect, it } from "vitest";
import {
  APPROVE_TOOL_NAME,
  SERVER_NAME,
  WORKSPACE_RESOURCE_URI,
  createBoardstateMcpServer,
  parseCliArgs,
} from "./index.js";

describe("@boardstate/mcp public surface", () => {
  it("re-exports the server factory and constants", () => {
    expect(typeof createBoardstateMcpServer).toBe("function");
    expect(SERVER_NAME).toBe("boardstate-mcp");
    expect(WORKSPACE_RESOURCE_URI).toBe("boardstate://workspace");
    expect(APPROVE_TOOL_NAME).toBe("boardstate_widget_approve");
  });

  it("parses --state-dir and --serve flags", () => {
    expect(parseCliArgs(["--state-dir", "/tmp/x"])).toEqual({ stateDir: "/tmp/x" });
    expect(parseCliArgs(["--state-dir=/tmp/y", "--serve", "4319"])).toEqual({
      stateDir: "/tmp/y",
      servePort: 4319,
    });
    expect(parseCliArgs(["--serve=8080"])).toEqual({ servePort: 8080 });
    expect(parseCliArgs(["-h"])).toEqual({ help: true });
  });

  it("rejects a bad --serve port and unknown flags", () => {
    expect(() => parseCliArgs(["--serve", "notaport"])).toThrow(/port/);
    expect(() => parseCliArgs(["--serve", "99999"])).toThrow(/port/);
    expect(() => parseCliArgs(["--state-dir"])).toThrow(/directory/);
    expect(() => parseCliArgs(["--wat"])).toThrow(/unknown argument/);
  });
});
