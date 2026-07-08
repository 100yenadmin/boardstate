// Public surface of @boardstate/lit: the reference Boardstate view as Lit custom
// elements, plus the builtin widget renderers and the injectable string table.
//
// Importing this module registers `<boardstate-view>` and `<boardstate-header>`
// (idempotent). Drive `<boardstate-view>` by setting its `transport` + `connected`
// properties; customize via `strings` / `onNavigate` / `storage` / `confirm` /
// `embed` / `basePath` / `initialTab`.
//
// The workspace store + adapters live in `@boardstate/host`; the headless
// read-model / transforms in `@boardstate/core`; the schema in `@boardstate/schema`.

import "./boardstate-view.js";
import "./boardstate-header.js";

export {
  BoardstateViewElement,
  renderBoardstateView,
  stopBoardstateView,
  boardstateDataVersion,
  bumpBoardstateDataVersion,
  type BoardstateViewProps,
  type BoardstateStorage,
  type BoardstateEmbedPolicy,
} from "./boardstate-view.js";
export {
  BoardstateHeaderElement,
  type BoardstateHeaderNavigateEvent,
} from "./boardstate-header.js";

export {
  renderWidgetCell,
  renderWidgetBody,
  renderBuiltinWidget,
  renderCustomWidget,
  displayWidgetTitle,
  type DashboardWidgetCellProps,
  type DashboardWidgetCellCallbacks,
  type DashboardCustomWidgetContext,
} from "./boardstate-widget-cell.js";
export {
  renderCustomWidgetHost,
  type CustomWidgetHostContext,
} from "./boardstate-custom-widget.js";

export {
  getBuiltinRenderer,
  BUILTIN_WIDGET_RENDERERS,
  type BuiltinWidgetContext,
  type BuiltinWidgetRenderer,
} from "./renderers/index.js";

export { toSanitizedMarkdownHtml } from "./markdown.js";
export { icons, type IconName } from "./icons.js";
export {
  en as DEFAULT_STRINGS,
  setBoardstateStrings,
  t as boardstateString,
  type BoardstateStrings,
  type BoardstateStringKey,
} from "./strings.js";
