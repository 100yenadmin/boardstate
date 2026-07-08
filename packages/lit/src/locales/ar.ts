// ar strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const ar: BoardstateStrings = {
  "common.save": "حفظ",
  "common.cancel": "إلغاء",
  "common.reload": "إعادة التحميل",
  "common.loading": "جارٍ التحميل…",
  "common.dismiss": "تجاهل",
  "dashboard.tabs.label": "مساحات العمل",
  "dashboard.tabs.hidden": "مخفي ({count})",
  "dashboard.empty.onboardingTitle": "لا توجد مساحات عمل حتى الآن",
  "dashboard.empty.tabTitle": "مساحة العمل هذه فارغة",
  "dashboard.widget.editTitleTitle": "تعديل عنوان الأداة",
  "dashboard.widget.editTitleLabel": "عنوان الأداة",
  "dashboard.widget.moveToTabEmpty": "لا توجد علامات تبويب أخرى لنقل هذا العنصر إليها.",
  "dashboard.widget.menu.editTitle": "تعديل العنوان",
  "dashboard.widget.menu.hide": "إخفاء",
  "dashboard.widget.menu.remove": "إزالة",
  "dashboard.widget.expand": "توسيع الأداة",
  "dashboard.widget.collapse": "طي الأداة",
  "dashboard.widget.moveHandle": "تحريك الأداة",
  "dashboard.widget.resizeHandle": "تغيير حجم الأداة",
  "dashboard.widget.approval.approve": "موافقة",
  "dashboard.widget.approval.reject": "رفض",
  "dashboard.widget.table.empty": "لا توجد صفوف لعرضها.",
  "dashboard.widget.table.more": "+{count} أخرى",
  "dashboard.widget.sessions.empty": "لا توجد جلسات بعد.",
  "dashboard.widget.usage.cost": "التكلفة",
  "dashboard.widget.usage.tokens": "الرموز",
  "dashboard.widget.cron.empty": "لا توجد مهام مجدولة.",
  "dashboard.widget.cron.next": "التالي {time}",
  "dashboard.widget.cron.noNext": "غير مجدول",
  "dashboard.widget.instances.empty": "لا توجد مثيلات متصلة.",
  "dashboard.widget.activity.empty": "لا يوجد نشاط حديث.",
  "dashboard.widget.approvals.approve": "موافقة",
  "common.back": "رجوع",
  "dashboard.history.actorUnknown": "غير معروف",
};

export default ar;
