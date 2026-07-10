---
"@boardstate/agent": minor
---

feat(agent): hard definition-token budget on shipped tool schemas (M5c-1)

The runner shipped every tool's full definition each turn and history truncation never
elided them, so an unbounded external (broker-granted) catalog would dwarf the prompt. The
runner now caps the shipped definitions (`toolDefTokenBudget`): core tools always ship in
full, `external` tools are kept most-recently-used-first until the budget is spent, and the
rest collapse to a name + one-line summary + a `boardstate_tool_search` hint. A collapsed
tool stays callable. The MRU persists per session across turns. Boards with no external tool
ship every definition verbatim (byte-identical to the pre-M5 loop).
