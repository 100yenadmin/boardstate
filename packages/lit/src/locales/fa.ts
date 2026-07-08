// fa strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const fa: BoardstateStrings = {
  "common.save": "ذخیره",
  "common.cancel": "لغو",
  "common.reload": "بارگذاری مجدد",
  "common.loading": "در حال بارگیری…",
  "common.dismiss": "بستن",
  "dashboard.tabs.label": "فضاهای کاری",
  "dashboard.tabs.hidden": "مخفی ({count})",
  "dashboard.empty.onboardingTitle": "هنوز فضای کاری وجود ندارد",
  "dashboard.empty.tabTitle": "این فضای کاری خالی است",
  "dashboard.widget.editTitleTitle": "ویرایش عنوان ویجت",
  "dashboard.widget.editTitleLabel": "عنوان ویجت",
  "dashboard.widget.moveToTabEmpty": "هیچ زبانه دیگری برای جابه‌جایی این ویجت وجود ندارد.",
  "dashboard.widget.menu.editTitle": "ویرایش عنوان",
  "dashboard.widget.menu.hide": "مخفی کردن",
  "dashboard.widget.menu.remove": "حذف",
  "dashboard.widget.expand": "گسترش ویجت",
  "dashboard.widget.collapse": "جمع کردن ویجت",
  "dashboard.widget.moveHandle": "جابجایی ویجت",
  "dashboard.widget.resizeHandle": "تغییر اندازه ویجت",
  "dashboard.widget.approval.approve": "تأیید",
  "dashboard.widget.approval.reject": "رد",
  "dashboard.widget.table.empty": "ردیفی برای نمایش وجود ندارد.",
  "dashboard.widget.table.more": "+{count} مورد دیگر",
  "dashboard.widget.sessions.empty": "هنوز نشستی وجود ندارد.",
  "dashboard.widget.usage.cost": "هزینه",
  "dashboard.widget.usage.tokens": "توکن‌ها",
  "dashboard.widget.cron.empty": "هیچ کار زمان‌بندی شده‌ای وجود ندارد.",
  "dashboard.widget.cron.next": "بعدی {time}",
  "dashboard.widget.cron.noNext": "زمان‌بندی نشده",
  "dashboard.widget.instances.empty": "هیچ نمونه متصلی وجود ندارد.",
  "dashboard.widget.activity.empty": "فعالیت اخیری وجود ندارد.",
  "dashboard.widget.approvals.approve": "تأیید",
  "common.back": "بازگشت",
  "dashboard.history.actorUnknown": "نامشخص",
};

export default fa;
