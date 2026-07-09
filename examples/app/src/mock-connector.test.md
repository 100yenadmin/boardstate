# mock-connector — manual verification

`mock-connector.ts` has no unit test; it is a demo data source verified by driving a
real in-process host. Reproduce the checks below (they mirror `examples/agent-smoke.mjs`
bring-up, but for the read/stream lanes instead of the agent loop).

## Setup

```js
import { DashboardStore, MemoryStorageAdapter } from "../../../packages/core/dist/index.js";
import { createInProcessHost } from "../../../packages/server/dist/index.js";
import { installMockConnector } from "./mock-connector.js"; // built dist in the app package

const storage = new MemoryStorageAdapter();
const store = new DashboardStore({ storage });
const host = createInProcessHost(store, storage);
const uninstall = installMockConnector(host);
```

## Checks

1. **RPC drift** — two `usage.cost` calls return DIFFERENT drifting totals:

   ```js
   const a = await host.request("usage.cost", {});
   const b = await host.request("usage.cost", {});
   // a.totals.totalCost !== b.totals.totalCost  → drift confirmed
   ```

2. **Stream ticker** — subscribe to `presence`; within ~5s ≥2 payloads arrive and each
   carries a 20-point `/ticker/series`:

   ```js
   host.addEventListener("presence", (p) => {
     // p.ticker.series.length === 20 ; p.ticker.revenue is a number
   });
   ```

3. **Non-empty builtins** — every registered method renders non-empty in its transform:
   `sessions.list` (6 rows), `agents.list` (4 rows w/ goal), `cron.list` (`{jobs:[…]}`),
   `system-presence`/`node.list` (`{presence|nodes:[…]}`), `usage.cost` (`{totals,days}`),
   `cron.runs` (`{entries:[…]}`), `health`/`usage.status` (coherent scalars).

4. **Uninstall** — after `uninstall()`, no further `presence` / `sessions.changed`
   events fire (both `clearInterval`ed).

## Binding cheatsheet (see `MOCK_DATA_PROMPT`)

- Live stat card → `{source:"stream",event:"presence",pointer:"/ticker/revenue"}`, `format:"usd"`.
- Live area chart → `{source:"stream",event:"presence",pointer:"/ticker/series"}`, `type:"area"`.
- RPC card → `{source:"rpc",method:"usage.cost",pointer:"/totals/totalCost"}`.
