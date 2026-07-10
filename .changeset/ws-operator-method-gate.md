---
"@boardstate/server": patch
---

Security: the WS transport now refuses **operator-only methods**
(`dashboard.widget.approve`) over the wire by default. The networked transport
threads no operator identity, so an operator ACTION arriving over the wire has
no authenticated operator behind it — yet `attachWsTransport` previously
forwarded EVERY method (scope is metadata, never a dispatch gate), so opening a
read-only networked viewer silently also exposed the widget-approval gate to any
client that passed `verifyClient` (a confused-deputy footgun). Approve is now
blocked before dispatch unless the host opts in with `allowOperatorMethods:
true` (for when it authenticates the operator itself in `verifyClient`).
Composing/driving the board over the wire is unchanged. Found while framing the
M4b capability broker (approve-unreachable-by-networked-requesters is its
prerequisite).
