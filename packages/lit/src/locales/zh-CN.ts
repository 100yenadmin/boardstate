// zh-CN strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const zh_CN: BoardstateStrings = {
  "common.save": "保存",
  "common.cancel": "取消",
  "common.reload": "重新加载",
  "common.loading": "加载中…",
  "common.dismiss": "关闭",
  "dashboard.tabs.label": "工作区",
  "dashboard.tabs.hidden": "已隐藏 ({count})",
  "dashboard.empty.onboardingTitle": "尚无工作区",
  "dashboard.empty.tabTitle": "此工作区为空",
  "dashboard.widget.editTitleTitle": "编辑小组件标题",
  "dashboard.widget.editTitleLabel": "小组件标题",
  "dashboard.widget.moveToTabEmpty": "没有其他标签页可以移动此小组件。",
  "dashboard.widget.menu.editTitle": "编辑标题",
  "dashboard.widget.menu.hide": "隐藏",
  "dashboard.widget.menu.remove": "移除",
  "dashboard.widget.expand": "展开小组件",
  "dashboard.widget.collapse": "收起小组件",
  "dashboard.widget.moveHandle": "移动小组件",
  "dashboard.widget.resizeHandle": "调整小组件大小",
  "dashboard.widget.approval.approve": "批准",
  "dashboard.widget.approval.reject": "拒绝",
  "dashboard.widget.table.empty": "没有可显示的行。",
  "dashboard.widget.table.more": "+{count} 项",
  "dashboard.widget.sessions.empty": "暂无会话。",
  "dashboard.widget.usage.cost": "费用",
  "dashboard.widget.cron.empty": "没有定时任务。",
  "dashboard.widget.cron.next": "下一次 {time}",
  "dashboard.widget.cron.noNext": "未计划",
  "dashboard.widget.instances.empty": "没有已连接的实例。",
  "dashboard.widget.activity.empty": "最近没有活动。",
  "dashboard.widget.approvals.approve": "批准",
  "common.back": "返回",
  "dashboard.history.actorUnknown": "未知",
};

export default zh_CN;
