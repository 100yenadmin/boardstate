import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_WORKSPACE } from "./default-workspace.js";
import { validateWorkspaceDoc, type WorkspaceDoc } from "./schema.js";

function validDoc(): WorkspaceDoc {
  return structuredClone(DEFAULT_DASHBOARD_WORKSPACE);
}

function expectInvalid(mutator: (doc: WorkspaceDoc) => void, message: string) {
  const doc = validDoc();
  mutator(doc);

  expect(() => validateWorkspaceDoc(doc)).toThrow(message);
}

describe("dashboard workspace schema", () => {
  it("accepts the default workspace seed", () => {
    expect(validateWorkspaceDoc(validDoc())).toEqual(validDoc());
  });

  it("rejects invalid tab slugs", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.slug = "Bad Slug";
    }, "tabs[0].slug");
  });

  it("rejects duplicate tab slugs", () => {
    expectInvalid((doc) => {
      doc.tabs.push({ ...structuredClone(doc.tabs[0]!), title: "Duplicate" });
    }, "duplicate tab slug");
  });

  it("rejects widget grid overflow", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.grid = { x: 10, y: 0, w: 3, h: 2 };
    }, "x + w");
  });

  it("rejects invalid widget kinds", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.kind = "builtin:unknown";
    }, "widgets[0].kind");
  });

  it("rejects invalid binding unions", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.bindings = {
        bad: { source: "command", value: "date" } as never,
      };
    }, "bindings.bad.source");
  });

  it("rejects non-allowlisted rpc binding methods at write time", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.bindings = {
        sessions: { source: "rpc", method: "config.get" },
      };
    }, "bindings.sessions.method is not allowlisted");
  });

  it("rejects tabs and widgets over the caps", () => {
    expectInvalid((doc) => {
      doc.tabs = Array.from({ length: 33 }, (_, index) => ({
        ...structuredClone(doc.tabs[0]!),
        slug: `tab-${index}`,
      }));
    }, "tabs must contain at most 32 entries");

    expectInvalid((doc) => {
      doc.tabs[0]!.widgets = Array.from({ length: 25 }, (_, index) => ({
        ...structuredClone(doc.tabs[0]!.widgets[0]!),
        id: `w_${index}`,
      }));
    }, "widgets must contain at most 24 entries");
  });

  it("accepts a full-bleed tab layout", () => {
    const doc = validDoc();
    doc.tabs[0]!.layout = "full";
    expect(validateWorkspaceDoc(doc).tabs[0]!.layout).toBe("full");
  });

  it("accepts an explicit grid tab layout", () => {
    const doc = validDoc();
    doc.tabs[0]!.layout = "grid";
    expect(validateWorkspaceDoc(doc).tabs[0]!.layout).toBe("grid");
  });

  it("defaults layout to undefined when omitted", () => {
    expect(validateWorkspaceDoc(validDoc()).tabs[0]!.layout).toBeUndefined();
  });

  it("rejects an invalid tab layout value", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.layout = "fullscreen" as never;
    }, 'layout must be "grid" or "full"');
  });

  it("rejects invalid createdBy provenance", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.createdBy = "robot" as never;
    }, "createdBy");
  });

  it("accepts stream bindings on allowlisted event channels", () => {
    const doc = validDoc();
    doc.tabs[0]!.widgets[0]!.bindings = {
      live: { source: "stream", event: "presence", pointer: "/online" },
    };
    expect(() => validateWorkspaceDoc(doc)).not.toThrow();
  });

  it("rejects stream bindings on non-allowlisted event channels", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.bindings = {
        live: { source: "stream", event: "evil.channel" } as never,
      };
    }, "bindings.live.event is not allowlisted");
  });

  it("accepts computed bindings for every whitelisted op", () => {
    for (const op of ["sum", "avg", "min", "max", "last", "count"]) {
      const doc = validDoc();
      doc.tabs[0]!.widgets[0]!.bindings = {
        total: { source: "computed", op, inputs: ["a", "b"] } as never,
        a: { source: "static", value: 1 },
        b: { source: "static", value: 2 },
      };
      expect(() => validateWorkspaceDoc(doc)).not.toThrow();
    }
    for (const [op, arg] of [
      ["pick", "/nested/value"],
      ["format", "{0} of {1}"],
    ]) {
      const doc = validDoc();
      doc.tabs[0]!.widgets[0]!.bindings = {
        derived: { source: "computed", op, inputs: ["a"], arg } as never,
        a: { source: "static", value: 1 },
      };
      expect(() => validateWorkspaceDoc(doc)).not.toThrow();
    }
  });

  it("rejects unknown computed ops", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.bindings = {
        total: { source: "computed", op: "eval", inputs: ["a"] } as never,
        a: { source: "static", value: 1 },
      };
    }, "bindings.total.op is not a valid computed op");
  });

  it("rejects malformed computed inputs (empty + non-string)", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.bindings = {
        total: { source: "computed", op: "sum", inputs: [] } as never,
      };
    }, "bindings.total.inputs must contain 1 to 32 entries");

    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.bindings = {
        total: { source: "computed", op: "sum", inputs: [{ nope: true }] } as never,
        a: { source: "static", value: 1 },
      };
    }, "bindings.total.inputs[0] is invalid");
  });

  it("requires arg for pick/format and forbids it elsewhere", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.bindings = {
        derived: { source: "computed", op: "pick", inputs: ["a"] } as never,
        a: { source: "static", value: 1 },
      };
    }, "bindings.derived.arg is required for the pick op");

    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.bindings = {
        total: { source: "computed", op: "sum", inputs: ["a"], arg: "x" } as never,
        a: { source: "static", value: 1 },
      };
    }, "bindings.total.arg is not allowed for the sum op");
  });

  it("rejects computed inputs that reference unknown or computed siblings (cycle policy)", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.bindings = {
        total: { source: "computed", op: "sum", inputs: ["missing"] } as never,
      };
    }, "references unknown binding: missing");

    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.bindings = {
        total: { source: "computed", op: "sum", inputs: ["mid"] } as never,
        mid: { source: "computed", op: "sum", inputs: ["a"] } as never,
        a: { source: "static", value: 1 },
      };
    }, "may not reference another computed binding: mid");

    // Direct self-reference is the degenerate cycle — also rejected.
    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.bindings = {
        total: { source: "computed", op: "sum", inputs: ["total"] } as never,
      };
    }, "may not reference another computed binding: total");
  });

  it("accepts a widget with a valid ISO ephemeral expiry", () => {
    const doc = validDoc();
    doc.tabs[0]!.widgets[0]!.ephemeral = { expiresAt: "2026-07-09T12:00:00.000Z" };
    const validated = validateWorkspaceDoc(doc);
    expect(validated.tabs[0]!.widgets[0]!.ephemeral).toEqual({
      expiresAt: "2026-07-09T12:00:00.000Z",
    });
  });

  it("rejects a non-ISO ephemeral expiry", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.ephemeral = { expiresAt: "next tuesday" };
    }, "expiresAt must be an ISO 8601 timestamp");
  });

  it("rejects an ephemeral expiry without a timezone", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.ephemeral = { expiresAt: "2026-07-09T12:00:00" };
    }, "expiresAt must be an ISO 8601 timestamp");
  });

  it("rejects unknown keys inside ephemeral", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.widgets[0]!.ephemeral = {
        expiresAt: "2026-07-09T12:00:00Z",
        ttl: 3600,
      } as never;
    }, "ephemeral.ttl is not allowed");
  });

  it("accepts a private tab with an owner and preserves both fields", () => {
    const doc = validDoc();
    doc.tabs[0]!.visibility = "private";
    doc.tabs[0]!.owner = "device:abc-123";
    const validated = validateWorkspaceDoc(doc);
    expect(validated.tabs[0]).toMatchObject({ visibility: "private", owner: "device:abc-123" });
  });

  it("drops visibility when shared (shared is the omitted default)", () => {
    const doc = validDoc();
    doc.tabs[0]!.visibility = "shared";
    const validated = validateWorkspaceDoc(doc);
    expect(validated.tabs[0]!.visibility).toBeUndefined();
  });

  it("rejects an invalid visibility value", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.visibility = "secret" as never;
    }, "visibility");
  });

  it("rejects an invalid owner identity", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.owner = "bad owner!";
    }, "owner");
  });

  it("rejects a private tab without an owner (owner required when private)", () => {
    expectInvalid((doc) => {
      doc.tabs[0]!.visibility = "private";
    }, "owner is required when the tab is private");
  });
});

describe("builtin:action-form props", () => {
  function withActionForm(props: unknown): WorkspaceDoc {
    const doc = validDoc();
    doc.tabs[0]!.widgets.push({
      id: "action-1",
      kind: "builtin:action-form",
      grid: { x: 0, y: 30, w: 4, h: 3 },
      collapsed: false,
      hidden: false,
      props: props as never,
    });
    return doc;
  }

  const validProps = () => ({
    template: "Deploy {service} to {env}",
    fields: [
      { name: "service", label: "Service", type: "text", maxLength: 40 },
      { name: "env", label: "Environment", type: "select", options: ["staging", "prod"] },
    ],
    buttonLabel: "Deploy",
  });

  it("accepts a well-formed action-form widget", () => {
    const validated = validateWorkspaceDoc(withActionForm(validProps()));
    const widget = validated.tabs[0]!.widgets.find((w) => w.id === "action-1");
    expect(widget?.kind).toBe("builtin:action-form");
  });

  it("rejects a template slot that is not a declared field", () => {
    const props = validProps();
    props.template = "Deploy {service} as {evil}";
    expect(() => validateWorkspaceDoc(withActionForm(props))).toThrow(
      "template references unknown field: {evil}",
    );
  });

  it("rejects more than 8 fields", () => {
    const props = validProps();
    props.fields = Array.from({ length: 9 }, (_, index) => ({
      name: `f${index}`,
      label: `Field ${index}`,
      type: "text" as const,
      maxLength: 10,
    }));
    props.template = "{f0}";
    expect(() => validateWorkspaceDoc(withActionForm(props))).toThrow(
      "fields must contain 1 to 8 entries",
    );
  });

  it("rejects a select field without options", () => {
    const props = validProps();
    props.fields[1] = { name: "env", label: "Environment", type: "select" } as never;
    expect(() => validateWorkspaceDoc(withActionForm(props))).toThrow("options");
  });

  it("rejects an unknown field type", () => {
    const props = validProps();
    props.fields[0] = { name: "service", label: "Service", type: "textarea" } as never;
    expect(() => validateWorkspaceDoc(withActionForm(props))).toThrow(
      "type must be text, number, or select",
    );
  });

  it("rejects a template over the length cap", () => {
    const props = validProps();
    props.template = "{service} ".repeat(300);
    expect(() => validateWorkspaceDoc(withActionForm(props))).toThrow("template must be 1-2000");
  });

  it("rejects a maxLength over the per-field cap", () => {
    const props = validProps();
    props.fields[0]!.maxLength = 5000;
    expect(() => validateWorkspaceDoc(withActionForm(props))).toThrow("maxLength");
  });

  it("accepts tool mode with connector + tool + argsFrom", () => {
    const props = {
      ...validProps(),
      mode: "tool",
      connector: "linear",
      tool: "create_issue",
      argsFrom: { title: "service", env: "env" },
    };
    const validated = validateWorkspaceDoc(withActionForm(props));
    expect(validated.tabs[0]!.widgets.find((w) => w.id === "action-1")?.props).toMatchObject({
      mode: "tool",
      connector: "linear",
    });
  });

  it("rejects an invalid mode value", () => {
    const props = { ...validProps(), mode: "webhook" };
    expect(() => validateWorkspaceDoc(withActionForm(props))).toThrow(
      'mode must be "prompt" or "tool"',
    );
  });

  it("rejects tool-only keys outside tool mode (prompt mode stays clean)", () => {
    const props = { ...validProps(), connector: "linear" };
    expect(() => validateWorkspaceDoc(withActionForm(props))).toThrow(
      'connector is only allowed when mode is "tool"',
    );
  });

  it("rejects tool mode missing its connector", () => {
    const props = { ...validProps(), mode: "tool", tool: "create_issue" };
    expect(() => validateWorkspaceDoc(withActionForm(props))).toThrow("connector must be a string");
  });

  it("rejects argsFrom targeting an undeclared field", () => {
    const props = {
      ...validProps(),
      mode: "tool",
      connector: "linear",
      tool: "create_issue",
      argsFrom: { title: "nope" },
    };
    expect(() => validateWorkspaceDoc(withActionForm(props))).toThrow(
      "argsFrom references unknown field: nope",
    );
  });
});

describe("builtin:action-button props", () => {
  function withButton(props: unknown): WorkspaceDoc {
    const doc = validDoc();
    doc.tabs[0]!.widgets.push({
      id: "btn-1",
      kind: "builtin:action-button",
      grid: { x: 0, y: 40, w: 3, h: 2 },
      collapsed: false,
      hidden: false,
      props: props as never,
    });
    return doc;
  }

  it("accepts a well-formed action-button", () => {
    const validated = validateWorkspaceDoc(
      withButton({
        connector: "officecli",
        tool: "restart_service",
        args: { svc: "x" },
        label: "Go",
      }),
    );
    expect(validated.tabs[0]!.widgets.find((w) => w.id === "btn-1")?.kind).toBe(
      "builtin:action-button",
    );
  });

  it("accepts an action-button with no args or label", () => {
    expect(() =>
      validateWorkspaceDoc(withButton({ connector: "officecli", tool: "restart_service" })),
    ).not.toThrow();
  });

  it("rejects an invalid connector name", () => {
    expect(() =>
      validateWorkspaceDoc(withButton({ connector: "bad connector", tool: "t" })),
    ).toThrow("connector is invalid");
  });

  it("rejects an invalid tool name", () => {
    expect(() =>
      validateWorkspaceDoc(withButton({ connector: "officecli", tool: "has:colon" })),
    ).toThrow("tool is invalid");
  });

  it("rejects a non-object args value", () => {
    expect(() =>
      validateWorkspaceDoc(withButton({ connector: "officecli", tool: "t", args: [1, 2] })),
    ).toThrow("args must be an object");
  });

  it("rejects an over-length label", () => {
    expect(() =>
      validateWorkspaceDoc(
        withButton({ connector: "officecli", tool: "t", label: "x".repeat(41) }),
      ),
    ).toThrow("label must be 1-40 characters");
  });

  it("rejects an unknown props key", () => {
    expect(() =>
      validateWorkspaceDoc(withButton({ connector: "officecli", tool: "t", url: "http://x" })),
    ).toThrow("url is not allowed");
  });
});

describe("mcp bindings (SPEC §18, shape only)", () => {
  function withBinding(binding: unknown): WorkspaceDoc {
    const doc = validDoc();
    doc.tabs[0]!.widgets[0]!.bindings = { data: binding as never };
    return doc;
  }

  it("accepts a well-formed mcp binding with args", () => {
    const validated = validateWorkspaceDoc(
      withBinding({
        source: "mcp",
        connector: "pipedream",
        tool: "list_rows",
        args: { limit: 10 },
      }),
    );
    expect(validated.tabs[0]!.widgets[0]!.bindings!.data).toEqual({
      source: "mcp",
      connector: "pipedream",
      tool: "list_rows",
      args: { limit: 10 },
    });
  });

  it("accepts an mcp binding without args", () => {
    expect(() =>
      validateWorkspaceDoc(
        withBinding({ source: "mcp", connector: "pipedream", tool: "list_rows" }),
      ),
    ).not.toThrow();
  });

  it("rejects an invalid connector", () => {
    expect(() =>
      validateWorkspaceDoc(withBinding({ source: "mcp", connector: "bad name", tool: "t" })),
    ).toThrow("connector is invalid");
  });

  it("rejects an unknown key", () => {
    expect(() =>
      validateWorkspaceDoc(
        withBinding({ source: "mcp", connector: "c", tool: "t", secret: "leak" }),
      ),
    ).toThrow("secret is not allowed");
  });

  it("rejects a non-object args", () => {
    expect(() =>
      validateWorkspaceDoc(withBinding({ source: "mcp", connector: "c", tool: "t", args: "x" })),
    ).toThrow("args must be an object");
  });
});

describe("capability grant tool grants (SPEC §17 v2)", () => {
  function withGrant(grant: unknown): WorkspaceDoc {
    const doc = validDoc();
    doc.capabilitiesRegistry = { officecli: grant as never };
    return doc;
  }

  it("accepts a grant with namespaced tool ids + toolsHash", () => {
    const validated = validateWorkspaceDoc(
      withGrant({
        status: "requested",
        methods: [],
        streams: [],
        tools: ["officecli:read_sheet", "officecli:send_mail"],
        toolsHash: "sha256-abc123",
      }),
    );
    expect(validated.capabilitiesRegistry!.officecli).toMatchObject({
      tools: ["officecli:read_sheet", "officecli:send_mail"],
      toolsHash: "sha256-abc123",
    });
  });

  it("accepts a tools-only grant with explicit empty methods/streams", () => {
    const validated = validateWorkspaceDoc(
      withGrant({ status: "requested", methods: [], streams: [], tools: ["officecli:read_sheet"] }),
    );
    const grant = validated.capabilitiesRegistry!.officecli!;
    expect(grant.methods).toEqual([]);
    expect(grant.streams).toEqual([]);
    expect(grant.tools).toEqual(["officecli:read_sheet"]);
  });

  it("still rejects a grant missing methods or streams (pre-§17 verdicts unchanged)", () => {
    expect(() =>
      validateWorkspaceDoc(
        withGrant({ status: "requested", streams: [], tools: ["officecli:read_sheet"] }),
      ),
    ).toThrow("methods must be an array");
    expect(() =>
      validateWorkspaceDoc(
        withGrant({ status: "requested", methods: [], tools: ["officecli:read_sheet"] }),
      ),
    ).toThrow("streams must be an array");
  });

  it("rejects a tool id without a connector:tool namespace", () => {
    expect(() =>
      validateWorkspaceDoc(
        withGrant({ status: "requested", methods: [], streams: [], tools: ["read_sheet"] }),
      ),
    ).toThrow("tools[0] is not a valid connector:tool id");
  });

  it("rejects a tool id over 64 characters", () => {
    expect(() =>
      validateWorkspaceDoc(
        withGrant({
          status: "requested",
          methods: [],
          streams: [],
          tools: [`c:${"t".repeat(64)}`],
        }),
      ),
    ).toThrow("tools[0] is not a valid connector:tool id");
  });

  it("does NOT validate tool ids against the read RPC allowlist", () => {
    // A grant's `tools` are external tool ids, not read RPCs — a namespaced id that
    // is nowhere in DATA_READ_RPC_ALLOWLIST is still valid.
    expect(() =>
      validateWorkspaceDoc(
        withGrant({
          status: "requested",
          methods: [],
          streams: [],
          tools: ["stripe:create_charge"],
        }),
      ),
    ).not.toThrow();
  });

  it("rejects a malformed toolsHash", () => {
    expect(() =>
      validateWorkspaceDoc(
        withGrant({ status: "requested", methods: [], streams: [], toolsHash: "bad hash!" }),
      ),
    ).toThrow("toolsHash is invalid");
  });

  it("rejects a grant with duplicate tool ids (a grant's tools are a set)", () => {
    expect(() =>
      validateWorkspaceDoc(
        withGrant({
          status: "requested",
          methods: [],
          streams: [],
          tools: ["officecli:read_mail", "officecli:read_mail"],
        }),
      ),
    ).toThrow("duplicate tool ids");
  });
});
