// Config validation is invariant #8's teeth: connectors exist ONLY here, unknown fields
// are rejected, and every `env` value must be a process-env var NAME (a reference), not
// a literal secret. A rejected value is never echoed back.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConnectorsConfig, parseConnectorsConfig } from "./config.js";
import { BrokerConfigError } from "./errors.js";

describe("parseConnectorsConfig", () => {
  it("accepts a valid stdio + http config", () => {
    const config = parseConnectorsConfig({
      connectors: [
        { name: "office", transport: "stdio", command: "office-cli", args: ["--mcp"] },
        {
          name: "pipedream",
          transport: "http",
          url: "https://mcp.example.com/mcp",
          headers: { Authorization: "Bearer ${PD_TOKEN}" },
          env: { PD_TOKEN: "OFFICE_PD_TOKEN" },
        },
      ],
    });
    expect(config.connectors).toHaveLength(2);
    expect(config.connectors[0]?.command).toBe("office-cli");
    expect(config.connectors[1]?.url).toBe("https://mcp.example.com/mcp");
  });

  it("rejects an unknown field on a connector", () => {
    expect(() =>
      parseConnectorsConfig({
        connectors: [{ name: "x", transport: "stdio", command: "c", secret: "oops" }],
      }),
    ).toThrow(/unknown field "secret"/);
  });

  it("rejects an unknown top-level field", () => {
    expect(() => parseConnectorsConfig({ connectors: [], extra: 1 })).toThrow(
      /unknown top-level field "extra"/,
    );
  });

  it("rejects a literal-looking secret in env (not an env-var reference)", () => {
    const literal = "sk-ant-super-secret-value-123";
    let thrown: unknown;
    try {
      parseConnectorsConfig({
        connectors: [{ name: "x", transport: "stdio", command: "c", env: { TOKEN: literal } }],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BrokerConfigError);
    // The offending value must NOT be echoed back into the error message.
    expect((thrown as Error).message).not.toContain(literal);
  });

  it("accepts an env value that IS a valid env-var name reference", () => {
    const config = parseConnectorsConfig({
      connectors: [{ name: "x", transport: "stdio", command: "c", env: { TOKEN: "OFFICE_TOKEN" } }],
    });
    expect(config.connectors[0]?.env).toEqual({ TOKEN: "OFFICE_TOKEN" });
  });

  it("rejects stdio without a command and http without a url", () => {
    expect(() =>
      parseConnectorsConfig({ connectors: [{ name: "x", transport: "stdio" }] }),
    ).toThrow(/requires a "command"/);
    expect(() => parseConnectorsConfig({ connectors: [{ name: "y", transport: "http" }] })).toThrow(
      /requires a "url"/,
    );
  });

  it("rejects url on stdio and command on http (transport mismatch)", () => {
    expect(() =>
      parseConnectorsConfig({
        connectors: [{ name: "x", transport: "stdio", command: "c", url: "https://x" }],
      }),
    ).toThrow(/"url" is not valid for a stdio/);
    expect(() =>
      parseConnectorsConfig({
        connectors: [{ name: "y", transport: "http", url: "https://x", command: "c" }],
      }),
    ).toThrow(/"command"\/"args" are not valid for an http/);
  });

  it("rejects a bad transport, a bad name, and duplicate names", () => {
    expect(() =>
      parseConnectorsConfig({ connectors: [{ name: "x", transport: "carrier-pigeon" }] }),
    ).toThrow(/transport must be/);
    expect(() =>
      parseConnectorsConfig({
        connectors: [{ name: "has space", transport: "stdio", command: "c" }],
      }),
    ).toThrow(/name must match/);
    expect(() =>
      parseConnectorsConfig({
        connectors: [
          { name: "dup", transport: "stdio", command: "a" },
          { name: "dup", transport: "stdio", command: "b" },
        ],
      }),
    ).toThrow(/duplicate connector name "dup"/);
  });

  it("rejects an invalid http url", () => {
    expect(() =>
      parseConnectorsConfig({ connectors: [{ name: "x", transport: "http", url: "not a url" }] }),
    ).toThrow(/is not a valid URL/);
  });
});

describe("loadConnectorsConfig", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "bs-broker-cfg-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads and validates a file", async () => {
    const path = join(dir, "boardstate.connectors.json");
    await writeFile(
      path,
      JSON.stringify({ connectors: [{ name: "office", transport: "stdio", command: "c" }] }),
    );
    const config = await loadConnectorsConfig(path);
    expect(config.connectors[0]?.name).toBe("office");
  });

  it("throws BrokerConfigError on a missing file", async () => {
    await expect(loadConnectorsConfig(join(dir, "nope.json"))).rejects.toBeInstanceOf(
      BrokerConfigError,
    );
  });

  it("throws BrokerConfigError on malformed JSON", async () => {
    const path = join(dir, "bad.json");
    await writeFile(path, "{ not json");
    await expect(loadConnectorsConfig(path)).rejects.toThrow(/not valid JSON/);
  });
});
