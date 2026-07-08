// ko strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const ko: BoardstateStrings = {
  "common.save": "저장",
  "common.cancel": "취소",
  "common.reload": "다시 로드",
  "common.loading": "로딩 중…",
  "common.dismiss": "닫기",
  "dashboard.tabs.label": "워크스페이스",
  "dashboard.tabs.hidden": "숨김 ({count})",
  "dashboard.empty.onboardingTitle": "아직 워크스페이스가 없습니다",
  "dashboard.empty.tabTitle": "이 워크스페이스는 비어 있습니다",
  "dashboard.widget.editTitleTitle": "위젯 제목 편집",
  "dashboard.widget.editTitleLabel": "위젯 제목",
  "dashboard.widget.moveToTabEmpty": "이 위젯을 이동할 다른 탭이 없습니다.",
  "dashboard.widget.menu.editTitle": "제목 편집",
  "dashboard.widget.menu.hide": "숨기기",
  "dashboard.widget.menu.remove": "제거",
  "dashboard.widget.expand": "위젯 펼치기",
  "dashboard.widget.collapse": "위젯 접기",
  "dashboard.widget.moveHandle": "위젯 이동",
  "dashboard.widget.resizeHandle": "위젯 크기 조정",
  "dashboard.widget.approval.approve": "승인",
  "dashboard.widget.approval.reject": "거부",
  "dashboard.widget.table.empty": "표시할 행이 없습니다.",
  "dashboard.widget.table.more": "+{count}개 더보기",
  "dashboard.widget.sessions.empty": "아직 세션이 없습니다.",
  "dashboard.widget.usage.cost": "비용",
  "dashboard.widget.usage.tokens": "토큰",
  "dashboard.widget.cron.empty": "예약된 작업이 없습니다.",
  "dashboard.widget.cron.next": "다음 {time}",
  "dashboard.widget.cron.noNext": "예약되지 않음",
  "dashboard.widget.instances.empty": "연결된 인스턴스가 없습니다.",
  "dashboard.widget.activity.empty": "최근 활동이 없습니다.",
  "dashboard.widget.approvals.approve": "승인",
  "common.back": "뒤로",
  "dashboard.history.actorUnknown": "알 수 없음",
};

export default ko;
