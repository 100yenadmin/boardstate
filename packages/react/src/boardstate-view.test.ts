import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardstateViewElement } from "@boardstate/lit";
import type { Transport } from "@boardstate/core";
import { BoardstateView } from "./boardstate-view.js";

/** A no-op transport stub (request resolves empty; subscribe returns an unsub). */
function stubTransport(): Transport {
  return {
    request: vi.fn(async () => ({})),
    addEventListener: vi.fn(() => () => {}),
  } as unknown as Transport;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
});

describe("BoardstateView", () => {
  it("mounts <boardstate-view>, upgrades it, and forwards the transport property", () => {
    const transport = stubTransport();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(createElement(BoardstateView, { transport }));
    });

    const el = container.querySelector("boardstate-view") as BoardstateViewElement | null;
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(customElements.get("boardstate-view"));
    expect(el?.transport).toBe(transport);
    expect(el?.connected).toBe(false);
  });

  it("re-syncs properties (including connected/strings/onNavigate) on prop changes", () => {
    const transport = stubTransport();
    const onNavigate = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(createElement(BoardstateView, { transport, connected: false }));
    });
    const el = container.querySelector("boardstate-view") as BoardstateViewElement;
    expect(el.connected).toBe(false);

    act(() => {
      root!.render(
        createElement(BoardstateView, {
          transport,
          connected: true,
          onNavigate,
          strings: { "common.save": "Store" },
          basePath: "/widgets",
          initialTab: "main",
        }),
      );
    });

    expect(el.connected).toBe(true);
    expect(el.onNavigate).toBe(onNavigate);
    expect(el.strings).toEqual({ "common.save": "Store" });
    expect(el.basePath).toBe("/widgets");
    expect(el.initialTab).toBe("main");
  });
});
