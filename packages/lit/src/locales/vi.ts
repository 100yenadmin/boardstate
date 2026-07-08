// vi strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const vi: BoardstateStrings = {
  "common.save": "Lưu",
  "common.cancel": "Hủy",
  "common.reload": "Tải lại",
  "common.loading": "Đang tải…",
  "common.dismiss": "Bỏ qua",
  "dashboard.tabs.label": "Không gian làm việc",
  "dashboard.tabs.hidden": "Đã ẩn ({count})",
  "dashboard.empty.onboardingTitle": "Chưa có không gian làm việc nào",
  "dashboard.empty.tabTitle": "Không gian làm việc này đang trống",
  "dashboard.widget.editTitleTitle": "Chỉnh sửa tiêu đề tiện ích",
  "dashboard.widget.editTitleLabel": "Tiêu đề tiện ích",
  "dashboard.widget.moveToTabEmpty": "Không có thẻ nào khác để chuyển widget này đến.",
  "dashboard.widget.menu.editTitle": "Chỉnh sửa tiêu đề",
  "dashboard.widget.menu.hide": "Ẩn",
  "dashboard.widget.menu.remove": "Xóa",
  "dashboard.widget.expand": "Mở rộng tiện ích",
  "dashboard.widget.collapse": "Thu gọn tiện ích",
  "dashboard.widget.moveHandle": "Di chuyển tiện ích",
  "dashboard.widget.resizeHandle": "Thay đổi kích thước tiện ích",
  "dashboard.widget.approval.approve": "Phê duyệt",
  "dashboard.widget.approval.reject": "Từ chối",
  "dashboard.widget.table.empty": "Không có hàng nào để hiển thị.",
  "dashboard.widget.table.more": "+{count} thêm",
  "dashboard.widget.sessions.empty": "Chưa có phiên nào.",
  "dashboard.widget.usage.cost": "Chi phí",
  "dashboard.widget.usage.tokens": "Token",
  "dashboard.widget.cron.empty": "Không có công việc định kỳ.",
  "dashboard.widget.cron.next": "Tiếp theo {time}",
  "dashboard.widget.cron.noNext": "Chưa lên lịch",
  "dashboard.widget.instances.empty": "Không có thực thể kết nối.",
  "dashboard.widget.activity.empty": "Không có hoạt động gần đây.",
  "dashboard.widget.approvals.approve": "Phê duyệt",
  "common.back": "Quay lại",
  "dashboard.history.actorUnknown": "Không xác định",
};

export default vi;
