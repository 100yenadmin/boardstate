// Typed errors for the broker. Every failure the host/server layers can act on is a
// named subclass of `BrokerError` so callers switch on the class (or `.code`) instead
// of string-matching messages.
//
// SECURITY: broker errors must NEVER carry a resolved env-var VALUE (a forwarded
// secret) — only the env-var NAME/reference. The config layer forbids literals up
// front; these error shapes keep the discipline downstream (no value fields).

/** Base for every broker-originated error. `code` is a stable machine tag. */
export class BrokerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** A connectors config that failed validation (unknown field, bad transport, non-ref env). */
export class BrokerConfigError extends BrokerError {
  constructor(message: string) {
    super("broker_config_invalid", message);
  }
}

/** A tool name (manifest id or provider-safe name) that overflows the 64-char budget. */
export class BrokerBudgetError extends BrokerError {
  constructor(message: string) {
    super("broker_name_budget", message);
  }
}

/** Two tools collapsing onto the same provider-safe name after sanitization. */
export class BrokerNameCollisionError extends BrokerError {
  constructor(message: string) {
    super("broker_name_collision", message);
  }
}

/** A connector name referenced at call time that is not in the operator config. */
export class BrokerUnknownConnectorError extends BrokerError {
  constructor(message: string) {
    super("broker_unknown_connector", message);
  }
}

/** Transport / handshake failure connecting to an external MCP server. */
export class BrokerConnectError extends BrokerError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("broker_connect_failed", message);
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** A `callTool` that exceeded its hard timeout. */
export class BrokerTimeoutError extends BrokerError {
  constructor(message: string) {
    super("broker_tool_timeout", message);
  }
}

/**
 * A tool call the server answered with `isError: true`. The normalized message is the
 * server's own text payload; `toolId` is the namespaced id that was called.
 */
export class BrokerToolError extends BrokerError {
  readonly toolId: string;
  constructor(toolId: string, message: string) {
    super("broker_tool_error", message);
    this.toolId = toolId;
  }
}
