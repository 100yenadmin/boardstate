// Parent-brokered, tab-scoped pub/sub bus for custom widgets (SPEC §11-I7).
//
// DOM-free and unit-testable: the broker holds every subscription and makes every
// delivery decision here, so tab-isolation and the caps can be tested without a
// DOM. The browser host wires each iframe's bridge to this shared singleton.
//
// SECURITY MODEL (normative):
// - Widgets NEVER talk to each other directly. The trusted parent is the sole
//   broker: a widget publishes to a channel, and the broker fans the payload out
//   to the OTHER widgets subscribed to that channel ON THE SAME TAB.
// - TAB ISOLATION is by construction: every subscription is keyed by `(tabSlug,
//   channel)` and a publish only ever iterates the publisher's own tab bucket. A
//   widget on tab A can never observe — or even enumerate — a subscriber on tab B.
// - IDENTITY is broker-assigned. Each bridge gets an opaque `subscriberId` the
//   widget never sees and cannot supply; the delivered message carries no
//   sender-controlled address, so a widget cannot spoof another's identity nor
//   target one specific widget (delivery is channel fan-out only, and the publisher
//   is excluded from its own broadcast).
// - The bus is in-memory and parent-brokered ONLY: it never touches the host and
//   never persists anything.
//
// The capability gate, the payload-size cap, and the publish rate limit live in
// the host bridge alongside the `sendPrompt` gates — this module trusts that
// publish/subscribe calls reaching it have already cleared those checks.

/** A broker-side subscription record. `subscriberId` is opaque + broker-assigned. */
type Subscription = {
  subscriberId: string;
  channel: string;
  /** Deliver an already-gated payload to this subscriber's child. */
  deliver: (channel: string, payload: unknown) => void;
};

/**
 * The tab-scoped subscription table: `tabSlug -> channel -> subscriberId ->
 * Subscription`. A publish resolves the publisher's tab bucket FIRST, so a message
 * can only ever reach same-tab subscribers — cross-tab delivery is unreachable, not
 * merely filtered out.
 */
const subscriptionsByTab = new Map<string, Map<string, Map<string, Subscription>>>();

/** Monotonic source of opaque, non-guessable-by-widgets subscriber identities. */
let subscriberSeq = 0;

/** Mint a fresh broker-assigned subscriber id. Never derived from widget input. */
export function nextSubscriberId(): string {
  subscriberSeq += 1;
  return `sub_${subscriberSeq}`;
}

/** Test-only: drop every subscription so suites start from a clean broker. */
export function resetBusForTest(): void {
  subscriptionsByTab.clear();
  subscriberSeq = 0;
}

/**
 * Register a subscription for `subscriberId` on `(tabSlug, channel)`. Idempotent
 * per `(tab, channel, subscriberId)`: re-subscribing replaces the record rather
 * than stacking duplicate deliveries. Returns an unsubscribe fn scoped to exactly
 * this `(tab, channel, subscriberId)` triple.
 */
export function subscribe(params: {
  tabSlug: string;
  channel: string;
  subscriberId: string;
  deliver: (channel: string, payload: unknown) => void;
}): () => void {
  const { tabSlug, channel, subscriberId, deliver } = params;
  let byChannel = subscriptionsByTab.get(tabSlug);
  if (!byChannel) {
    byChannel = new Map();
    subscriptionsByTab.set(tabSlug, byChannel);
  }
  let bySubscriber = byChannel.get(channel);
  if (!bySubscriber) {
    bySubscriber = new Map();
    byChannel.set(channel, bySubscriber);
  }
  bySubscriber.set(subscriberId, { subscriberId, channel, deliver });
  return () => unsubscribe({ tabSlug, channel, subscriberId });
}

/** Remove one subscription, pruning empty channel/tab buckets so nothing leaks. */
export function unsubscribe(params: {
  tabSlug: string;
  channel: string;
  subscriberId: string;
}): void {
  const { tabSlug, channel, subscriberId } = params;
  const byChannel = subscriptionsByTab.get(tabSlug);
  const bySubscriber = byChannel?.get(channel);
  if (!bySubscriber) {
    return;
  }
  bySubscriber.delete(subscriberId);
  if (bySubscriber.size === 0) {
    byChannel?.delete(channel);
  }
  if (byChannel && byChannel.size === 0) {
    subscriptionsByTab.delete(tabSlug);
  }
}

/**
 * Remove EVERY subscription owned by `subscriberId` on `tabSlug` (unmount teardown).
 * The bridge tracks its own channels, but this is the belt-and-suspenders sweep so a
 * disposed widget can never receive a dangling delivery.
 */
export function unsubscribeAll(tabSlug: string, subscriberId: string): void {
  const byChannel = subscriptionsByTab.get(tabSlug);
  if (!byChannel) {
    return;
  }
  for (const [channel, bySubscriber] of byChannel) {
    if (bySubscriber.delete(subscriberId) && bySubscriber.size === 0) {
      byChannel.delete(channel);
    }
  }
  if (byChannel.size === 0) {
    subscriptionsByTab.delete(tabSlug);
  }
}

/**
 * Broker a publish: deliver `payload` on `channel` to every OTHER same-tab
 * subscriber (the publisher, identified by `fromSubscriberId`, is excluded from its
 * own broadcast). Cross-tab delivery is impossible — only the publisher's own tab
 * bucket is ever consulted. Returns the number of subscribers reached (for tests).
 */
export function publish(params: {
  tabSlug: string;
  channel: string;
  fromSubscriberId: string;
  payload: unknown;
}): number {
  const { tabSlug, channel, fromSubscriberId, payload } = params;
  const bySubscriber = subscriptionsByTab.get(tabSlug)?.get(channel);
  if (!bySubscriber) {
    return 0;
  }
  let delivered = 0;
  // Snapshot before delivering so a subscriber that (un)subscribes inside its own
  // handler cannot mutate the set mid-iteration.
  for (const subscription of Array.from(bySubscriber.values())) {
    if (subscription.subscriberId === fromSubscriberId) {
      continue;
    }
    subscription.deliver(channel, payload);
    delivered += 1;
  }
  return delivered;
}
