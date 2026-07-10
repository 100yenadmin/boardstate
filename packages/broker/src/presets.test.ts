import { describe, expect, it } from "vitest";
import { McpBroker } from "./broker.js";
import { parseConnectorsConfig } from "./config.js";
import {
  CONNECTOR_PRESETS,
  composioPreset,
  detectBinary,
  officeCliPreset,
  pipedreamPreset,
} from "./presets.js";

describe("connector presets", () => {
  it("catalogs the three first-party presets by id", () => {
    expect(Object.keys(CONNECTOR_PRESETS).sort()).toEqual(["composio", "officecli", "pipedream"]);
    expect(CONNECTOR_PRESETS.officecli).toBe(officeCliPreset);
    expect(CONNECTOR_PRESETS.pipedream).toBe(pipedreamPreset);
    expect(CONNECTOR_PRESETS.composio).toBe(composioPreset);
  });

  it("every preset stamps a config the real broker parser accepts", () => {
    const configs = [
      officeCliPreset.build(),
      pipedreamPreset.build(),
      composioPreset.build({ url: "https://mcp.composio.dev/session/abc123" }),
    ];
    for (const config of configs) {
      // parseConnectorsConfig is the validator McpBroker trusts — a preset that survives
      // it round-trips into a live broker with no further massaging.
      expect(() => parseConnectorsConfig({ connectors: [config] })).not.toThrow();
      expect(() => new McpBroker({ connectors: [config] })).not.toThrow();
    }
  });

  describe("officeCliPreset (#46)", () => {
    it("is a stdio `officecli mcp` connector with an install pointer", () => {
      const config = officeCliPreset.build();
      expect(config).toMatchObject({
        name: "officecli",
        transport: "stdio",
        command: "officecli",
        args: ["mcp"],
      });
      expect(officeCliPreset.requiresBinary?.command).toBe("officecli");
      expect(officeCliPreset.requiresBinary?.install).toMatch(/OfficeCLI/);
      expect(officeCliPreset.docs).toBe("docs/connectors/officecli.md");
    });

    it("honors a name override", () => {
      expect(officeCliPreset.build({ name: "office" }).name).toBe("office");
    });
  });

  describe("pipedreamPreset (#47)", () => {
    it("is a remote http connector whose secrets are env REFS, never literals", () => {
      const config = pipedreamPreset.build();
      expect(config.transport).toBe("http");
      expect(config.url).toMatch(/^https:\/\/remote\.mcp\.pipedream\.net\//);
      // Secret hygiene (invariant #4): the Authorization header is an env REF, and the
      // serialized config contains no token-looking literal.
      expect(config.headers?.Authorization).toBe("Bearer ${PIPEDREAM_ACCESS_TOKEN}");
      expect(config.headers?.["x-pd-external-user-id"]).toBe("${PIPEDREAM_EXTERNAL_USER_ID}");
      expect(JSON.stringify(config)).not.toMatch(/[A-Za-z0-9]{32,}/);
      expect(pipedreamPreset.envRefs).toContain("PIPEDREAM_ACCESS_TOKEN");
    });

    it("accepts a re-verified endpoint override (2026 auth cutover)", () => {
      const config = pipedreamPreset.build({ url: "https://remote.mcp.pipedream.net/v4/mcp" });
      expect(config.url).toBe("https://remote.mcp.pipedream.net/v4/mcp");
    });
  });

  describe("composioPreset (#47)", () => {
    it("requires a per-user session url and carries an env-ref api key", () => {
      // The session URL is per-user and minted at setup time — omitting it fails loud.
      expect(() => composioPreset.build()).toThrow(/session `url`/);
      const config = composioPreset.build({ url: "https://mcp.composio.dev/session/xyz" });
      expect(config.transport).toBe("http");
      expect(config.url).toBe("https://mcp.composio.dev/session/xyz");
      expect(config.headers?.["x-api-key"]).toBe("${COMPOSIO_API_KEY}");
      expect(JSON.stringify(config)).not.toContain("COMPOSIO_API_KEY_VALUE");
    });
  });

  describe("detectBinary", () => {
    it("resolves a bare name against PATH", () => {
      expect(detectBinary("node")).toBe(true);
      expect(detectBinary("this-binary-does-not-exist-xyz")).toBe(false);
    });

    it("checks an absolute path directly", () => {
      expect(detectBinary(process.execPath)).toBe(true);
      expect(detectBinary("/no/such/path/officecli")).toBe(false);
    });

    it("uses the injected PATH, spawning nothing", () => {
      expect(detectBinary("officecli", { PATH: "/nowhere" })).toBe(false);
    });
  });
});
