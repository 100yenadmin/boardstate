// th strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const th: BoardstateStrings = {
  "common.save": "บันทึก",
  "common.cancel": "ยกเลิก",
  "common.reload": "โหลดใหม่",
  "common.loading": "กำลังโหลด…",
  "common.dismiss": "ปิด",
  "dashboard.tabs.label": "พื้นที่ทำงาน",
  "dashboard.tabs.hidden": "ซ่อน ({count})",
  "dashboard.empty.onboardingTitle": "ยังไม่มีพื้นที่ทำงาน",
  "dashboard.empty.tabTitle": "พื้นที่ทำงานนี้ว่างเปล่า",
  "dashboard.widget.editTitleTitle": "แก้ไขชื่อวิดเจ็ต",
  "dashboard.widget.editTitleLabel": "ชื่อวิดเจ็ต",
  "dashboard.widget.moveToTabEmpty": "ไม่มีแท็บอื่นให้ย้ายวิดเจ็ตนี้ไป",
  "dashboard.widget.menu.editTitle": "แก้ไขชื่อ",
  "dashboard.widget.menu.hide": "ซ่อน",
  "dashboard.widget.menu.remove": "ลบ",
  "dashboard.widget.expand": "ขยายวิดเจ็ต",
  "dashboard.widget.collapse": "ย่อวิดเจ็ต",
  "dashboard.widget.moveHandle": "ย้ายวิดเจ็ต",
  "dashboard.widget.resizeHandle": "ปรับขนาดวิดเจ็ต",
  "dashboard.widget.approval.approve": "อนุมัติ",
  "dashboard.widget.approval.reject": "ปฏิเสธ",
  "dashboard.widget.table.empty": "ไม่มีข้อมูล",
  "dashboard.widget.table.more": "+{count} รายการถัดไป",
  "dashboard.widget.sessions.empty": "ยังไม่มีเซสชัน",
  "dashboard.widget.usage.cost": "ค่าใช้จ่าย",
  "dashboard.widget.usage.tokens": "โทเคน",
  "dashboard.widget.cron.empty": "ไม่มีงานที่กำหนดเวลาไว้",
  "dashboard.widget.cron.next": "ถัดไป {time}",
  "dashboard.widget.cron.noNext": "ไม่ได้กำหนดเวลาไว้",
  "dashboard.widget.instances.empty": "ไม่มีอินสแตนซ์ที่เชื่อมต่อ",
  "dashboard.widget.activity.empty": "ไม่มีกิจกรรมล่าสุด",
  "dashboard.widget.approvals.approve": "อนุมัติ",
  "common.back": "ย้อนกลับ",
  "dashboard.history.actorUnknown": "ไม่ทราบ",
};

export default th;
