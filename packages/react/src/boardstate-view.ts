// `BoardstateView` — a thin React wrapper over `<boardstate-view>` (the reference
// Boardstate view custom element shipped by `@boardstate/lit`).
//
// React 19 renders custom elements natively (no wrapper library needed to mount the
// tag itself), but several of `<boardstate-view>`'s properties can't be forwarded as
// ordinary JSX/`createElement` attributes:
//   - `transport`, `strings`, and `onNavigate` are declared `{ attribute: false }` on
//     the element (objects/functions have no useful string-attribute form), so Lit
//     only ever reads them as DOM properties.
//   - `connected` is a `Boolean`-typed Lit property. React serializes a primitive
//     `false` prop on a custom element as the literal attribute `connected="false"`
//     rather than removing the attribute; Lit's default Boolean converter treats ANY
//     attribute presence (including `"false"`) as `true`. Forwarding it as a JSX
//     attribute would silently invert a `connected={false}` caller.
// All four are therefore set as DOM properties via a ref in a `useEffect`, matching
// how `@boardstate/lit`'s own tests drive the element. `basePath`/`initialTab` are
// plain `String`-typed Lit properties with no such pitfall, but are set the same way
// for a single, uniform sync path.
//
// Importing this module (transitively, via `@boardstate/lit`) registers
// `<boardstate-view>` as a side effect.

import { createElement, useEffect, useRef, type ReactElement } from "react";
import "@boardstate/lit";
import type { BoardstateStrings, BoardstateViewElement } from "@boardstate/lit";
import type { Transport } from "@boardstate/core";

/** Props accepted by the `BoardstateView` React component. */
export interface BoardstateViewProps {
  /** Control-plane transport driving the view. */
  transport: Transport;
  /** Whether the transport is live (gates load/subscribe/poll). Defaults to `false`. */
  connected?: boolean;
  /** String overrides merged over the English defaults. */
  strings?: BoardstateStrings;
  /** Called with a tab slug when the operator selects a workspace tab. */
  onNavigate?: (slug: string) => void;
  /** HTTP base path for custom-widget iframe assets. */
  basePath?: string;
  /** Initial active tab slug (deep-link seed); the app owns URL parsing. */
  initialTab?: string | null;
}

/**
 * Renders `<boardstate-view>`, syncing `props` onto the element as DOM properties.
 * See the module doc above for why properties (not attributes) are used throughout.
 */
export function BoardstateView(props: BoardstateViewProps): ReactElement {
  const { transport, connected, strings, onNavigate, basePath, initialTab } = props;
  const ref = useRef<BoardstateViewElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    el.transport = transport;
    el.connected = connected ?? false;
    el.strings = strings;
    el.onNavigate = onNavigate;
    el.basePath = basePath;
    el.initialTab = initialTab ?? null;
  }, [transport, connected, strings, onNavigate, basePath, initialTab]);

  return createElement("boardstate-view", { ref });
}
