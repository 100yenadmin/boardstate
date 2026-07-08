// zh-TW strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const zh_TW: BoardstateStrings = {
  "common.save": "儲存",
  "common.cancel": "取消",
  "common.reload": "重新載入",
  "common.loading": "載入中…",
  "common.dismiss": "關閉",
  "dashboard.tabs.label": "工作區",
  "dashboard.tabs.hidden": "隱藏 ({count})",
  "dashboard.empty.onboardingTitle": "尚無工作區",
  "dashboard.empty.tabTitle": "此工作區是空的",
  "dashboard.widget.editTitleTitle": "編輯小工具標題",
  "dashboard.widget.editTitleLabel": "小工具標題",
  "dashboard.widget.moveToTabEmpty": "沒有其他分頁可供移動此小工具。",
  "dashboard.widget.menu.editTitle": "編輯標題",
  "dashboard.widget.menu.hide": "隱藏",
  "dashboard.widget.menu.remove": "移除",
  "dashboard.widget.expand": "展開小工具",
  "dashboard.widget.collapse": "摺疊小工具",
  "dashboard.widget.moveHandle": "移動小工具",
  "dashboard.widget.resizeHandle": "調整小工具大小",
  "dashboard.widget.approval.approve": "核准",
  "dashboard.widget.approval.reject": "拒絕",
  "dashboard.widget.table.empty": "沒有可顯示的列。",
  "dashboard.widget.table.more": "還有 {count} 項",
  "dashboard.widget.sessions.empty": "尚無工作階段。",
  "dashboard.widget.usage.cost": "費用",
  "dashboard.widget.cron.empty": "沒有預定的作業。",
  "dashboard.widget.cron.next": "下一次 {time}",
  "dashboard.widget.cron.noNext": "未排定",
  "dashboard.widget.instances.empty": "沒有已連線的執行個體。",
  "dashboard.widget.activity.empty": "沒有近期活動。",
  "dashboard.widget.approvals.approve": "核准",
  "common.back": "返回",
  "dashboard.history.actorUnknown": "未知",
};

export default zh_TW;
