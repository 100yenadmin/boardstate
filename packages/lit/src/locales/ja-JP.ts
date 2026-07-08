// ja-JP strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const ja_JP: BoardstateStrings = {
  "common.save": "保存",
  "common.cancel": "キャンセル",
  "common.reload": "再読み込み",
  "common.loading": "読み込み中…",
  "common.dismiss": "閉じる",
  "dashboard.tabs.label": "ワークスペース",
  "dashboard.tabs.hidden": "非表示 ({count})",
  "dashboard.empty.onboardingTitle": "まだワークスペースがありません",
  "dashboard.empty.tabTitle": "このワークスペースは空です",
  "dashboard.widget.editTitleTitle": "ウィジェットのタイトルを編集",
  "dashboard.widget.editTitleLabel": "ウィジェットのタイトル",
  "dashboard.widget.moveToTabEmpty": "移動先のタブがありません。",
  "dashboard.widget.menu.editTitle": "タイトルを編集",
  "dashboard.widget.menu.hide": "非表示",
  "dashboard.widget.menu.remove": "削除",
  "dashboard.widget.expand": "ウィジェットを展開する",
  "dashboard.widget.collapse": "ウィジェットを折りたたむ",
  "dashboard.widget.moveHandle": "ウィジェットを移動",
  "dashboard.widget.resizeHandle": "ウィジェットのサイズ変更",
  "dashboard.widget.approval.approve": "承認する",
  "dashboard.widget.approval.reject": "拒否する",
  "dashboard.widget.table.empty": "表示する行がありません。",
  "dashboard.widget.table.more": "+{count} 件",
  "dashboard.widget.sessions.empty": "まだセッションがありません。",
  "dashboard.widget.usage.cost": "コスト",
  "dashboard.widget.usage.tokens": "トークン",
  "dashboard.widget.cron.empty": "スケジュールされたジョブはありません。",
  "dashboard.widget.cron.next": "次回 {time}",
  "dashboard.widget.cron.noNext": "スケジュールされていません",
  "dashboard.widget.instances.empty": "接続中のインスタンスはありません。",
  "dashboard.widget.activity.empty": "最近のアクティビティはありません。",
  "dashboard.widget.approvals.approve": "承認する",
  "common.back": "戻る",
  "dashboard.history.actorUnknown": "不明",
};

export default ja_JP;
