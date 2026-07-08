# @boardstate/react

Thin React wrapper over the `<boardstate-view>` custom element shipped by
[`@boardstate/lit`](../lit). React 19 renders custom elements natively; this
package just syncs typed props onto the element as DOM properties.

## Usage

```tsx
import { BoardstateView } from "@boardstate/react";
import type { Transport } from "@boardstate/react";

function Dashboard({ transport }: { transport: Transport }) {
  return (
    <BoardstateView
      transport={transport}
      connected={true}
      basePath="/widgets"
      onNavigate={(slug) => console.log("navigated to", slug)}
    />
  );
}
```

`strings` accepts a partial `BoardstateStrings` override table; `initialTab` seeds
the active tab slug for deep links. See `@boardstate/lit`'s `BoardstateViewProps`
doc comments for the full behavior of each field.
