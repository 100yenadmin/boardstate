// Parent side of the custom-widget postMessage bridge (SPEC §7-§8).
//
// DOM-free and unit-testable: the DOM host (`mount.ts`) wires a real iframe + window
// listener to `createWidgetBridge`, but every security decision — accept filter,
// manifest gating, capability checks, rate limiting, timeouts — lives here so it can
// be tested without a DOM.
//
// SECURITY MODEL (normative):
// - The child's origin is opaque (`null`) because the iframe is sandboxed without
//   `allow-same-origin`. NEVER compare origin strings; the accept filter is the
//   IDENTITY check `event.source === iframe.contentWindow`, wired by the host.
// - A widget may only request bindings declared in the manifest the operator
//   approved. Undeclared bindingId → `dashboard:error {code:"binding_denied"}`.
// - `sendPrompt` requires the manifest `prompt:send` capability AND an operator
//   confirm per invocation AND a rate limit (1 in-flight, 10/min).
// - `getState`/`setState` require the `state:persist` capability; the widgetId is
//   host-bound (never read from the child), so a widget can only touch its own state.
// - Inter-widget pub/sub (`dashboard:publish`/`subscribe`/`unsubscribe` →
//   `dashboard:message`) is parent-brokered and requires the `bus:pubsub`
//   capability for BOTH directions (an ungated widget can neither publish nor
//   subscribe, so it can never receive). Publishes are capped by payload size and a
//   rolling-window rate limit. Tab isolation and publisher-exclusion are enforced by
//   the broker off HOST-supplied identity — this bridge only forwards an opaque
//   channel + payload and never reads addressing from the child message.
// - Parent→child posts always use targetOrigin "*" (opaque origin), carrying only
//   binding data / theme tokens the widget is entitled to — never secrets.

import type { WidgetManifestView } from "@boardstate/core";
import { dispatchRateLimitedPrompt, getPromptRateState } from "./prompt-gate.js";

export { resetPromptRateStatesForTest } from "./prompt-gate.js";
export type { PromptDispatchOutcome } from "./prompt-gate.js";
export { dispatchRateLimitedPrompt } from "./prompt-gate.js";

export const BRIDGE_ENVELOPE_VERSION = 1;

/**
 * Browser-safe mirror of the host's write-time rpc allowlist
 * (`@boardstate/schema` `DATA_READ_RPC_ALLOWLIST`). KEEP IN SYNC — a conformance
 * guard asserts this equals the schema const so drift is caught in CI. Mirrored
 * (not imported) because the schema module pulls in `node:path`, which must never
 * enter a browser bundle. This enables the resolve-time re-check below
 * (defense-in-depth over the write-time gate).
 */
export const RPC_METHOD_ALLOWLIST: readonly string[] = [
  "health",
  "system-presence",
  "usage.status",
  "usage.cost",
  "agents.list",
  "sessions.list",
  "sessions.resolve",
  "sessions.get",
  "sessions.usage",
  "sessions.usage.timeseries",
  "sessions.usage.logs",
  "node.list",
  "node.describe",
  "cron.get",
  "cron.list",
  "cron.status",
  "cron.runs",
];

const RPC_METHOD_ALLOWLIST_SET = new Set(RPC_METHOD_ALLOWLIST);

/** True when an rpc binding method is in the allowlist (resolve-time re-check). */
export function isRpcMethodAllowed(method: string): boolean {
  return RPC_METHOD_ALLOWLIST_SET.has(method);
}

/**
 * Browser-safe mirror of the host's `STREAM_EVENT_ALLOWLIST` (@boardstate/schema).
 * KEEP IN SYNC — a conformance guard asserts equality. A `stream` binding may only
 * subscribe to one of these gateway broadcast channels; the client re-checks the id
 * here (defense-in-depth) so it never listens on an arbitrary channel even if a
 * malformed doc slipped past the write-time schema.
 */
export const STREAM_EVENT_ALLOWLIST: readonly string[] = [
  "presence",
  "sessions.changed",
  "boardstate.changed",
];

const STREAM_EVENT_ALLOWLIST_SET = new Set(STREAM_EVENT_ALLOWLIST);

/** True when a stream binding's event channel is allowlisted (resolve-time re-check). */
export function isStreamEventAllowed(event: string): boolean {
  return STREAM_EVENT_ALLOWLIST_SET.has(event);
}

/**
 * Browser-safe mirror of the host's `COMPUTED_OPS` (@boardstate/schema). KEEP IN
 * SYNC — a conformance guard asserts equality. The client resolves a `computed`
 * binding with a fixed switch over exactly these ops — never eval.
 */
export const COMPUTED_OPS: readonly string[] = [
  "sum",
  "avg",
  "min",
  "max",
  "last",
  "count",
  "pick",
  "format",
];

/** child→parent message types. */
export type WidgetInboundType =
  | "dashboard:ready"
  | "dashboard:getData"
  | "dashboard:getTheme"
  | "dashboard:sendPrompt"
  | "dashboard:getState"
  | "dashboard:setState"
  | "dashboard:publish"
  | "dashboard:subscribe"
  | "dashboard:unsubscribe";

/** parent→child message types. */
export type WidgetOutboundType =
  | "dashboard:data"
  | "dashboard:push"
  | "dashboard:theme"
  | "dashboard:error"
  | "dashboard:state"
  | "dashboard:message";

export type WidgetErrorCode =
  | "binding_denied"
  | "capability_denied"
  | "rate_limited"
  | "prompt_declined"
  | "timeout"
  | "resolve_failed"
  | "payload_too_large"
  | "malformed";

export type WidgetOutboundMessage =
  | { v: 1; type: "dashboard:data"; requestId: string; bindingId: string; data: unknown }
  | { v: 1; type: "dashboard:push"; bindingId: string; data: unknown }
  | { v: 1; type: "dashboard:theme"; requestId: string; tokens: Record<string, string> }
  | { v: 1; type: "dashboard:state"; requestId: string; state: unknown; version?: number }
  | { v: 1; type: "dashboard:message"; channel: string; payload: unknown }
  | { v: 1; type: "dashboard:error"; requestId?: string; code: WidgetErrorCode; message: string };

/**
 * The identity-bound slice of the pub/sub broker the bridge is allowed to touch.
 * The DOM host (`mount.ts`) injects this, closing over the HOST-tracked
 * `(tabSlug, subscriberId)` so the bridge never sees — and a child message can never
 * supply — the addressing that enforces tab isolation and the publisher-exclusion.
 * The bridge only ever passes an opaque `channel`/`payload`.
 */
export type WidgetBusBridge = {
  /** Fan a payload out to same-tab peers on `channel` (publisher excluded). */
  publish: (channel: string, payload: unknown) => void;
  /**
   * Register `deliver` for `channel` on this widget's tab. Returns an unsubscribe
   * fn scoped to exactly this subscription.
   */
  subscribe: (channel: string, deliver: (channel: string, payload: unknown) => void) => () => void;
};

/** Injected side effects — real implementations live in the DOM host. */
export type WidgetBridgeDeps = {
  manifest: WidgetManifestView;
  /** Resolve a manifest-declared binding by id (file/static via data.read, rpc via gateway). */
  resolveBinding: (bindingId: string) => Promise<unknown>;
  /**
   * Resolve-time gate run BEFORE `resolveBinding` (defense-in-depth). Return a
   * WidgetErrorCode to deny WITHOUT touching the gateway (e.g. an rpc binding whose
   * method is not allowlisted → "binding_denied"), or null to allow. Optional; when
   * omitted, every declared binding is allowed to resolve.
   */
  assertBindingAllowed?: (bindingId: string) => WidgetErrorCode | null;
  /** Current theme tokens (CSS custom-property values from the document root). */
  resolveTheme: () => Record<string, string>;
  /** Operator confirm dialog quoting the exact prompt text; resolves true to send. */
  confirmPrompt: (text: string) => Promise<boolean>;
  /** Dispatch the prompt through the existing chat-send path. */
  sendPrompt: (text: string) => Promise<void>;
  /**
   * Read THIS widget's persisted state blob (or null). The parent binds the widgetId
   * from the trusted iframe context; the widget cannot name another widget's state.
   * Required only when the manifest holds `state:persist` — omitted otherwise.
   */
  getWidgetState?: () => Promise<{ state: unknown; version?: number }>;
  /**
   * Persist THIS widget's opaque state blob (parent-bound widgetId). Resolves to the
   * new version on success. Required only when the manifest holds `state:persist`.
   */
  setWidgetState?: (blob: unknown) => Promise<{ version: number }>;
  /**
   * Identity-bound pub/sub broker for this widget. Optional: when omitted the
   * `dashboard:publish`/`subscribe`/`unsubscribe` inbound types are inert (the
   * host only injects a bus for widgets rendered inside a tab).
   */
  bus?: WidgetBusBridge;
  /** Post a message to the child (host wires targetOrigin "*"). */
  post: (message: WidgetOutboundMessage) => void;
  /** getData answer deadline; posts a timeout error if the resolver overruns. Default 10s. */
  getDataTimeoutMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
};

export type WidgetBridge = {
  /** Handle one already-source-verified inbound message. Returns true if accepted. */
  handleMessage: (data: unknown) => boolean;
  /** Push fresh data for a declared binding to the child (broadcast-driven). */
  push: (bindingId: string) => Promise<void>;
  /** Count of messages dropped by the accept filter (well-formedness). For tests. */
  readonly droppedCount: number;
  dispose: () => void;
};

const DEFAULT_GET_DATA_TIMEOUT_MS = 10_000;

/**
 * Pub/sub caps. The payload cap bounds a single broadcast; the rate limiter mirrors
 * the sendPrompt limiter (a rolling-window count keyed by stable widget name so a
 * remount cannot reset it), sized higher than sendPrompt because pub/sub is a
 * cheap in-memory, same-tab backchannel (a filter driving a chart) rather than an
 * agent round-trip. The channel-name cap keeps registry keys bounded.
 */
const BUS_MAX_PAYLOAD_BYTES = 8 * 1024;
const BUS_MAX_CHANNEL_LEN = 256;
const BUS_PUBLISH_RATE_WINDOW_MS = 60_000;
const BUS_PUBLISH_RATE_MAX = 60;

/**
 * Publish rate-limit state, keyed by STABLE widget name (not the bridge instance),
 * for the same remount-survival reason as the prompt rate states.
 */
type BusRateState = { timestamps: number[] };
const busRateStates = new Map<string, BusRateState>();

function getBusRateState(widgetName: string): BusRateState {
  let state = busRateStates.get(widgetName);
  if (!state) {
    state = { timestamps: [] };
    busRateStates.set(widgetName, state);
  }
  return state;
}

/** Test-only: reset all persisted publish rate budgets. */
export function resetBusRateStatesForTest(): void {
  busRateStates.clear();
}

/**
 * Approximate the serialized byte size of a publish payload for the size cap.
 * Returns null when the payload cannot be serialized (e.g. a BigInt), which the
 * caller treats as a malformed publish. `undefined` (no payload) serializes to 0.
 */
function approxPayloadBytes(payload: unknown): number | null {
  let json: string | undefined;
  try {
    json = JSON.stringify(payload);
  } catch {
    return null;
  }
  if (json === undefined) {
    return 0;
  }
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(json).length : json.length;
}

const INBOUND_TYPES = new Set<WidgetInboundType>([
  "dashboard:ready",
  "dashboard:getData",
  "dashboard:getTheme",
  "dashboard:sendPrompt",
  "dashboard:getState",
  "dashboard:setState",
  "dashboard:publish",
  "dashboard:subscribe",
  "dashboard:unsubscribe",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Well-formedness filter: a valid inbound message is an object with `v === 1` and
 * a known `type`. Anything else is dropped silently (counted for tests). This runs
 * AFTER the host's `event.source === iframe.contentWindow` identity check.
 */
export function isWellFormedInbound(
  data: unknown,
): data is { v: 1; type: WidgetInboundType } & Record<string, unknown> {
  return (
    isRecord(data) &&
    data.v === BRIDGE_ENVELOPE_VERSION &&
    typeof data.type === "string" &&
    INBOUND_TYPES.has(data.type as WidgetInboundType)
  );
}

/** Creates the parent-side bridge for one approved custom widget. */
export function createWidgetBridge(deps: WidgetBridgeDeps): WidgetBridge {
  const now = deps.now ?? (() => Date.now());
  const getDataTimeoutMs = deps.getDataTimeoutMs ?? DEFAULT_GET_DATA_TIMEOUT_MS;
  const declaredBindingIds = new Set(deps.manifest.bindingIds);
  // Capabilities are compared as strings so the bridge can gate capabilities the
  // core `WidgetManifestView` type does not yet enumerate (e.g. `bus:pubsub`).
  const capabilities = new Set<string>(deps.manifest.capabilities);
  let dropped = 0;
  let disposed = false;
  // Rate-limit state is keyed by the widget NAME (stable identity), so it persists
  // across bridge re-instantiation when the iframe is recreated.
  const rateState = getPromptRateState(deps.manifest.name);
  const busRateState = getBusRateState(deps.manifest.name);
  // This bridge's own bus subscriptions, `channel -> unsubscribe`. Owned here so
  // dispose() can sever every delivery even if the child never unsubscribes.
  const busUnsubByChannel = new Map<string, () => void>();
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  function error(code: WidgetErrorCode, message: string, requestId?: string): void {
    deps.post({
      v: 1,
      type: "dashboard:error",
      ...(requestId !== undefined ? { requestId } : {}),
      code,
      message,
    });
  }

  async function handleGetData(requestId: string, bindingId: string): Promise<void> {
    if (!declaredBindingIds.has(bindingId)) {
      // A widget cannot request a binding the operator did not approve.
      error("binding_denied", `binding not declared in manifest: ${bindingId}`, requestId);
      return;
    }
    // Resolve-time gate (defense-in-depth): e.g. an rpc binding whose method is not
    // allowlisted is denied here WITHOUT touching the gateway, even though the
    // write-time schema should already have rejected it.
    const denied = deps.assertBindingAllowed?.(bindingId);
    if (denied) {
      error(denied, `binding not allowed: ${bindingId}`, requestId);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled || disposed) {
        return;
      }
      settled = true;
      pendingTimers.delete(timer);
      error("timeout", "binding resolution timed out", requestId);
    }, getDataTimeoutMs);
    pendingTimers.add(timer);
    try {
      const data = await deps.resolveBinding(bindingId);
      if (settled || disposed) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      pendingTimers.delete(timer);
      deps.post({ v: 1, type: "dashboard:data", requestId, bindingId, data });
    } catch (err) {
      if (settled || disposed) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      pendingTimers.delete(timer);
      error("resolve_failed", err instanceof Error ? err.message : String(err), requestId);
    }
  }

  function handleGetTheme(requestId: string): void {
    deps.post({ v: 1, type: "dashboard:theme", requestId, tokens: deps.resolveTheme() });
  }

  async function handleSendPrompt(requestId: string, text: string): Promise<void> {
    if (!capabilities.has("prompt:send")) {
      // Denied WITHOUT showing a dialog — the capability gate is first.
      error("capability_denied", "widget lacks the prompt:send capability", requestId);
      return;
    }
    // The rate limit (keyed by widget name so a remount cannot reset the budget)
    // and the operator confirm both live in the shared gate, so this sandboxed
    // path and the trusted action-form builtin cannot diverge.
    try {
      const outcome = await dispatchRateLimitedPrompt({
        widgetKey: deps.manifest.name,
        text,
        confirmPrompt: deps.confirmPrompt,
        sendPrompt: deps.sendPrompt,
        now,
      });
      if (disposed) {
        return;
      }
      if (outcome === "rate_limited") {
        error("rate_limited", "prompt send rate limit exceeded", requestId);
      } else if (outcome === "declined") {
        error("prompt_declined", "operator declined the prompt", requestId);
      }
    } catch (err) {
      if (!disposed) {
        error("resolve_failed", err instanceof Error ? err.message : String(err), requestId);
      }
    }
  }

  async function handleGetState(requestId: string): Promise<void> {
    // Same capability-gate shape as sendPrompt: denied WITHOUT touching the gateway.
    if (!capabilities.has("state:persist") || !deps.getWidgetState) {
      error("capability_denied", "widget lacks the state:persist capability", requestId);
      return;
    }
    try {
      const result = await deps.getWidgetState();
      if (disposed) {
        return;
      }
      deps.post({
        v: 1,
        type: "dashboard:state",
        requestId,
        state: result.state,
        ...(result.version !== undefined ? { version: result.version } : {}),
      });
    } catch (err) {
      if (!disposed) {
        error("resolve_failed", err instanceof Error ? err.message : String(err), requestId);
      }
    }
  }

  async function handleSetState(requestId: string, blob: unknown): Promise<void> {
    if (!capabilities.has("state:persist") || !deps.setWidgetState) {
      error("capability_denied", "widget lacks the state:persist capability", requestId);
      return;
    }
    try {
      // The parent supplies the widgetId (bound to THIS iframe); any widgetId in the
      // child's message is ignored — only the blob crosses the trust boundary here.
      const { version } = await deps.setWidgetState(blob);
      if (disposed) {
        return;
      }
      deps.post({ v: 1, type: "dashboard:state", requestId, state: blob, version });
    } catch (err) {
      if (!disposed) {
        error("resolve_failed", err instanceof Error ? err.message : String(err), requestId);
      }
    }
  }

  function handlePublish(channel: string, payload: unknown, requestId?: string): void {
    // Capability gate FIRST — an ungated widget cannot publish (nor, since it can
    // never subscribe either, receive). Mirrors the sendPrompt capability gate.
    if (!capabilities.has("bus:pubsub")) {
      error("capability_denied", "widget lacks the bus:pubsub capability", requestId);
      return;
    }
    if (!deps.bus) {
      return;
    }
    const size = approxPayloadBytes(payload);
    if (size === null) {
      error("malformed", "publish payload is not serializable", requestId);
      return;
    }
    if (size > BUS_MAX_PAYLOAD_BYTES) {
      error(
        "payload_too_large",
        `publish payload exceeds ${BUS_MAX_PAYLOAD_BYTES} bytes`,
        requestId,
      );
      return;
    }
    // Rolling-window rate limit keyed by widget name (mirrors sendPrompt).
    const cutoff = now() - BUS_PUBLISH_RATE_WINDOW_MS;
    busRateState.timestamps = busRateState.timestamps.filter((ts) => ts > cutoff);
    if (busRateState.timestamps.length >= BUS_PUBLISH_RATE_MAX) {
      error("rate_limited", "publish rate limit exceeded", requestId);
      return;
    }
    busRateState.timestamps.push(now());
    // The broker fans out to OTHER same-tab subscribers only; identity (tab +
    // publisher id) is host-supplied, never read from `channel`/`payload`.
    deps.bus.publish(channel, payload);
  }

  function handleSubscribe(channel: string): void {
    if (!capabilities.has("bus:pubsub") || !deps.bus) {
      // Ungated widgets cannot subscribe, so they can never receive a delivery.
      if (!capabilities.has("bus:pubsub")) {
        error("capability_denied", "widget lacks the bus:pubsub capability");
      }
      return;
    }
    if (busUnsubByChannel.has(channel)) {
      // Idempotent: a re-subscribe to the same channel keeps the single delivery.
      return;
    }
    const unsub = deps.bus.subscribe(channel, (ch, payload) => {
      if (disposed) {
        return;
      }
      deps.post({ v: 1, type: "dashboard:message", channel: ch, payload });
    });
    busUnsubByChannel.set(channel, unsub);
  }

  function handleUnsubscribe(channel: string): void {
    // No capability gate needed: this only tears down THIS widget's own delivery.
    const unsub = busUnsubByChannel.get(channel);
    if (unsub) {
      busUnsubByChannel.delete(channel);
      unsub();
    }
  }

  function handleMessage(data: unknown): boolean {
    if (disposed) {
      return false;
    }
    if (!isWellFormedInbound(data)) {
      dropped += 1;
      return false;
    }
    switch (data.type) {
      case "dashboard:ready":
        return true;
      case "dashboard:getData": {
        const requestId = typeof data.requestId === "string" ? data.requestId : null;
        const bindingId = typeof data.bindingId === "string" ? data.bindingId : null;
        if (requestId === null || bindingId === null) {
          dropped += 1;
          return false;
        }
        void handleGetData(requestId, bindingId);
        return true;
      }
      case "dashboard:getTheme": {
        const requestId = typeof data.requestId === "string" ? data.requestId : null;
        if (requestId === null) {
          dropped += 1;
          return false;
        }
        handleGetTheme(requestId);
        return true;
      }
      case "dashboard:sendPrompt": {
        const requestId = typeof data.requestId === "string" ? data.requestId : null;
        const text = typeof data.text === "string" ? data.text : null;
        if (requestId === null || text === null || !text.trim()) {
          dropped += 1;
          return false;
        }
        void handleSendPrompt(requestId, text);
        return true;
      }
      case "dashboard:getState": {
        const requestId = typeof data.requestId === "string" ? data.requestId : null;
        if (requestId === null) {
          dropped += 1;
          return false;
        }
        void handleGetState(requestId);
        return true;
      }
      case "dashboard:setState": {
        const requestId = typeof data.requestId === "string" ? data.requestId : null;
        // The `state` key must be present (any JSON value, incl. null). A widgetId in
        // the message is deliberately NOT read here — the parent owns the id.
        if (requestId === null || !Object.hasOwn(data, "state")) {
          dropped += 1;
          return false;
        }
        void handleSetState(requestId, data.state);
        return true;
      }
      case "dashboard:publish": {
        const channel = typeof data.channel === "string" ? data.channel : null;
        const requestId = typeof data.requestId === "string" ? data.requestId : undefined;
        if (channel === null || !channel.trim() || channel.length > BUS_MAX_CHANNEL_LEN) {
          dropped += 1;
          return false;
        }
        if (!("payload" in data)) {
          dropped += 1;
          return false;
        }
        handlePublish(channel, data.payload, requestId);
        return true;
      }
      case "dashboard:subscribe": {
        const channel = typeof data.channel === "string" ? data.channel : null;
        if (channel === null || !channel.trim() || channel.length > BUS_MAX_CHANNEL_LEN) {
          dropped += 1;
          return false;
        }
        handleSubscribe(channel);
        return true;
      }
      case "dashboard:unsubscribe": {
        const channel = typeof data.channel === "string" ? data.channel : null;
        if (channel === null || !channel.trim() || channel.length > BUS_MAX_CHANNEL_LEN) {
          dropped += 1;
          return false;
        }
        handleUnsubscribe(channel);
        return true;
      }
      default:
        dropped += 1;
        return false;
    }
  }

  async function push(bindingId: string): Promise<void> {
    if (disposed || !declaredBindingIds.has(bindingId) || deps.assertBindingAllowed?.(bindingId)) {
      // A disallowed binding is never pushed (same gate as getData; silent for push).
      return;
    }
    try {
      const data = await deps.resolveBinding(bindingId);
      if (!disposed) {
        deps.post({ v: 1, type: "dashboard:push", bindingId, data });
      }
    } catch {
      // Push is best-effort; a failed refresh keeps the last value on the child.
    }
  }

  return {
    handleMessage,
    push,
    get droppedCount() {
      return dropped;
    },
    dispose() {
      disposed = true;
      for (const timer of pendingTimers) {
        clearTimeout(timer);
      }
      pendingTimers.clear();
      // Sever every bus delivery this widget was receiving, so a disposed/unmounted
      // widget can never get a dangling `dashboard:message` (belt to the host's
      // unsubscribeAll suspenders).
      for (const unsub of busUnsubByChannel.values()) {
        unsub();
      }
      busUnsubByChannel.clear();
      // Release the in-flight lock so a remount can send again, but PRESERVE the
      // rolling-window timestamps — clearing them would reopen the very reset hole
      // this state exists to close.
      rateState.inFlight = false;
    },
  };
}
