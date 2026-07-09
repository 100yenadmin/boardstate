// The standalone demo's scripted stand-in for a real model loop (SPEC §14). It emits
// the full `AgentStreamEvent` sequence with realistic pacing (~40ms text deltas) and
// drives REAL `dashboard.*` tool calls through the in-process host — the SAME control
// plane a human uses — so "watch an agent build a board" is the genuine protocol, not
// a faked animation. Deterministic for a fixed message; honors the AbortSignal (a
// mid-turn `chat.abort` stops the script cleanly, and the host emits the terminal
// abort + turn-end).

import type { WorkspaceDoc } from "@boardstate/core";
import type { ChatAgent, ChatAgentContext, InProcessHost } from "@boardstate/server";

const AGENT_ACTOR = "agent:assistant";
const TEXT_DELTA_MS = 40;
const INSIGHTS_SLUG = "insights";
const LIVE_SLUG = "live";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const newId = (): string => globalThis.crypto.randomUUID();

/** Stream one assistant text block as a start → delta* → end triad (~40ms/word). */
async function streamText(ctx: ChatAgentContext, sessionKey: string, body: string): Promise<void> {
  if (ctx.signal.aborted) {
    return;
  }
  const id = newId();
  ctx.emit({ type: "text-start", sessionKey, turnId: ctx.turnId, id });
  // Split into words (keeping trailing spaces) so deltas read naturally as they land.
  // Pacing is SCHEDULE-based, not sleep-per-word: hidden tabs throttle setTimeout
  // (down to one wake per minute under Chrome's intensive throttling), so we only
  // await when ahead of schedule and burst every overdue word on each wake — a
  // backgrounded turn catches up instead of crawling.
  const startedAt = Date.now();
  let index = 0;
  for (const part of body.match(/\S+\s*/g) ?? [body]) {
    if (ctx.signal.aborted) {
      // Leave the block open — the invariant permits an unmatched *-start on abort,
      // and the host owns the terminal abort + turn-end.
      return;
    }
    const due = startedAt + index * TEXT_DELTA_MS;
    const wait = due - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    ctx.emit({ type: "text-delta", sessionKey, turnId: ctx.turnId, id, delta: part });
    index += 1;
  }
  if (ctx.signal.aborted) {
    return;
  }
  ctx.emit({ type: "text-end", sessionKey, turnId: ctx.turnId, id });
}

/**
 * Emit a tool-call triad (start → ready) and EXECUTE it for real through the host,
 * then emit the `tool-result`. The raw `tool-call-delta` carries the args text as a
 * UI affordance only (SPEC §14.2 — consumers never parse it).
 */
async function toolCall(
  ctx: ChatAgentContext,
  host: InProcessHost,
  sessionKey: string,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const callId = newId();
  ctx.emit({ type: "tool-call-start", sessionKey, turnId: ctx.turnId, callId, name });
  ctx.emit({
    type: "tool-call-delta",
    sessionKey,
    turnId: ctx.turnId,
    callId,
    argsTextDelta: JSON.stringify(args),
  });
  ctx.emit({ type: "tool-call-ready", sessionKey, turnId: ctx.turnId, callId, name, args });
  try {
    const result = await host.request(name, args, { agentId: AGENT_ACTOR, sessionKey });
    ctx.emit({ type: "tool-result", sessionKey, turnId: ctx.turnId, callId, ok: true, result });
  } catch (error) {
    ctx.emit({
      type: "tool-result",
      sessionKey,
      turnId: ctx.turnId,
      callId,
      ok: false,
      error: {
        code: "tool_error",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    });
  }
}

/** Drop a prior run's tab (silent — not a tool call) so the build replays. */
async function ensureFreshTab(host: InProcessHost, slug: string): Promise<void> {
  const { doc } = (await host.request("dashboard.workspace.get")) as { doc: WorkspaceDoc };
  if (doc.tabs.some((tab) => tab.slug === slug)) {
    await host.request("dashboard.tab.delete", { slug, actor: AGENT_ACTOR });
  }
}

/**
 * The live-ticker scripted build (suggestion chip 3): a tab of `stream`-bound widgets
 * fed by the mock connector's 2s `presence` broadcasts — the board visibly ticks with
 * no key and no manual refresh. Same real control plane; the ONLY scripted part is
 * which tools get called.
 */
async function buildLiveTicker(
  ctx: ChatAgentContext,
  host: InProcessHost,
  sessionKey: string,
): Promise<void> {
  await ensureFreshTab(host, LIVE_SLUG);
  if (ctx.signal.aborted) {
    return;
  }
  await streamText(
    ctx,
    sessionKey,
    "Live it is — I’ll bind widgets to the demo feed’s `presence` stream so they tick on their own.",
  );
  if (ctx.signal.aborted) {
    return;
  }
  await toolCall(ctx, host, sessionKey, "dashboard.tab.create", {
    slug: LIVE_SLUG,
    title: "Live ticker",
    actor: AGENT_ACTOR,
  });
  if (ctx.signal.aborted) {
    return;
  }
  const stream = (pointer: string) => ({
    value: { source: "stream", event: "presence", pointer },
  });
  const widgets: Record<string, unknown>[] = [
    {
      id: "live-revenue",
      kind: "builtin:stat-card",
      title: "Revenue",
      grid: { x: 0, y: 0, w: 4, h: 2 },
      bindings: stream("/ticker/revenue"),
      props: { label: "Revenue (live)", format: "usd" },
    },
    {
      id: "live-users",
      kind: "builtin:stat-card",
      title: "Active users",
      grid: { x: 4, y: 0, w: 4, h: 2 },
      bindings: stream("/ticker/activeUsers"),
      props: { label: "Active users" },
    },
    {
      id: "live-p95",
      kind: "builtin:stat-card",
      title: "p95 latency",
      grid: { x: 8, y: 0, w: 4, h: 2 },
      bindings: stream("/ticker/p95ms"),
      props: { label: "p95 (ms)" },
    },
    {
      id: "live-series",
      kind: "builtin:chart",
      title: "Revenue trend (streaming)",
      grid: { x: 0, y: 2, w: 8, h: 5 },
      bindings: stream("/ticker/series"),
      props: { type: "area" },
    },
    {
      id: "live-note",
      kind: "builtin:markdown",
      title: "How this works",
      grid: { x: 8, y: 2, w: 4, h: 5 },
      props: {
        markdown:
          '## Live bindings\n\nEach widget carries\n`{ source: "stream", event: "presence", pointer: "/ticker/…" }`\n— the view subscribes over the transport and re-renders per event.\n\n_No polling, no sockets in core: the host broadcasts, bindings listen._',
      },
    },
  ];
  for (const widget of widgets) {
    if (ctx.signal.aborted) {
      return;
    }
    await toolCall(ctx, host, sessionKey, "dashboard.widget.add", {
      tab: LIVE_SLUG,
      actor: AGENT_ACTOR,
      widget,
    });
  }
  if (ctx.signal.aborted) {
    return;
  }
  await streamText(
    ctx,
    sessionKey,
    "Done — open the “Live ticker” tab and watch the numbers move. Every value streams in over the same control plane.",
  );
  if (ctx.signal.aborted) {
    return;
  }
  ctx.emit({ type: "usage", sessionKey, turnId: ctx.turnId, inputTokens: 112, outputTokens: 208 });
  ctx.emit({ type: "turn-end", sessionKey, turnId: ctx.turnId, stopReason: "end" });
}

/**
 * Build a scripted demo agent over an in-process host. "build me…"-style prompts run
 * the full build (compose an Insights tab with a live chart + summary); anything else
 * gets a shorter reply and a single read (`dashboard.workspace.get`).
 */
export function createMockAgent(host: InProcessHost): ChatAgent {
  return async ({ sessionKey, message }, ctx) => {
    ctx.emit({ type: "turn-start", sessionKey, turnId: ctx.turnId });

    if (/\blive\b|\bticker\b|\bstream/i.test(message)) {
      await buildLiveTicker(ctx, host, sessionKey);
      return;
    }

    const wantsBuild = /\bbuild\b|\bcreate\b|\bmake\b|dashboard|insights/i.test(message);

    if (!wantsBuild) {
      await streamText(
        ctx,
        sessionKey,
        "Hi! I can compose dashboards on this board. Ask me to “build me an insights view” and watch it happen.",
      );
      if (ctx.signal.aborted) {
        return;
      }
      await toolCall(ctx, host, sessionKey, "dashboard.workspace.get", {});
      if (ctx.signal.aborted) {
        return;
      }
      await streamText(ctx, sessionKey, "That’s the current board — tell me what to build.");
      if (ctx.signal.aborted) {
        return;
      }
      ctx.emit({
        type: "usage",
        sessionKey,
        turnId: ctx.turnId,
        inputTokens: 24,
        outputTokens: 40,
      });
      ctx.emit({ type: "turn-end", sessionKey, turnId: ctx.turnId, stopReason: "end" });
      return;
    }

    // Full build. Reset a prior Insights tab first so a second run replays cleanly.
    await ensureFreshTab(host, INSIGHTS_SLUG);
    if (ctx.signal.aborted) {
      return;
    }

    await streamText(ctx, sessionKey, "On it — let me look at the current board first.");
    if (ctx.signal.aborted) {
      return;
    }
    await toolCall(ctx, host, sessionKey, "dashboard.workspace.get", {});
    if (ctx.signal.aborted) {
      return;
    }

    await streamText(
      ctx,
      sessionKey,
      "Composing an “Insights” tab with a live chart and a summary…",
    );
    if (ctx.signal.aborted) {
      return;
    }
    await toolCall(ctx, host, sessionKey, "dashboard.tab.create", {
      slug: INSIGHTS_SLUG,
      title: "Insights",
      actor: AGENT_ACTOR,
    });
    if (ctx.signal.aborted) {
      return;
    }
    await toolCall(ctx, host, sessionKey, "dashboard.widget.add", {
      tab: INSIGHTS_SLUG,
      actor: AGENT_ACTOR,
      widget: {
        id: "insights-trend",
        kind: "builtin:chart",
        title: "Signal volume (14d)",
        grid: { x: 0, y: 0, w: 8, h: 5 },
        props: { type: "area" },
        bindings: {
          value: {
            source: "static",
            value: [8, 12, 10, 18, 24, 21, 30, 28, 35, 33, 41, 38, 47, 52],
          },
        },
      },
    });
    if (ctx.signal.aborted) {
      return;
    }
    await toolCall(ctx, host, sessionKey, "dashboard.widget.add", {
      tab: INSIGHTS_SLUG,
      actor: AGENT_ACTOR,
      widget: {
        id: "insights-summary",
        kind: "builtin:markdown",
        title: "Summary",
        grid: { x: 8, y: 0, w: 4, h: 5 },
        props: {
          markdown:
            "## Insights\n\n- Signal volume up **6.5×** across 14 days.\n- Momentum accelerates late-window.\n\n_Composed live over the same `dashboard.*` control plane a human uses._",
        },
      },
    });
    if (ctx.signal.aborted) {
      return;
    }

    await streamText(
      ctx,
      sessionKey,
      "Done — the Insights tab is live with a chart and a summary. Open it to take a look.",
    );
    if (ctx.signal.aborted) {
      return;
    }
    ctx.emit({ type: "usage", sessionKey, turnId: ctx.turnId, inputTokens: 96, outputTokens: 184 });
    ctx.emit({ type: "turn-end", sessionKey, turnId: ctx.turnId, stopReason: "end" });
  };
}
