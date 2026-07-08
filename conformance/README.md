# @boardstate/conformance

The reusable transport-conformance suite (SPEC §2, §12). Drive a real client
against your host over your host's own transport and pin the exact wire shapes.

```ts
import { runTransportConformance } from "@boardstate/conformance";

runTransportConformance(
  async () => {
    const { transport, teardown } = await standUpMyHost(); // your Transport
    return { transport, teardown };
  },
  {
    extensions: { widgetState: true, history: true }, // opt-in surfaces
    // operators: async () => ({ a, b, unidentified, teardown }), // §11-I6
  },
);
```

`runTransportConformance` registers vitest `describe`/`it` blocks; call it from a
`*.test.ts` file. Seed only over the transport (`dashboard.workspace.replace`).
