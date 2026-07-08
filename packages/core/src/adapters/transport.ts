// The client-side control-plane seam. A host binds one impl (its own gateway /
// websocket / in-process bridge) so the client-resolved half of the dashboard
// (rpc + stream bindings, live-update subscription, optimistic mutations) never
// depends on a concrete transport. Defined here; consumed by the host package.
export interface Transport {
  /** Issue a control-plane request (`dashboard.*` method) and await its response. */
  request(method: string, params?: unknown): Promise<unknown>;
  /** Subscribe to a broadcast event (e.g. `boardstate.changed`); returns an unsubscribe fn. */
  addEventListener(event: string, fn: (payload: unknown) => void): () => void;
}
