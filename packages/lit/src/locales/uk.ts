// uk strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const uk: BoardstateStrings = {
  "common.save": "Зберегти",
  "common.cancel": "Скасувати",
  "common.reload": "Перезавантажити",
  "common.loading": "Завантаження…",
  "common.dismiss": "Закрити",
  "dashboard.tabs.label": "Робочі простори",
  "dashboard.tabs.hidden": "Приховані ({count})",
  "dashboard.empty.onboardingTitle": "Ще немає робочих просторів",
  "dashboard.empty.tabTitle": "Цей робочий простір порожній",
  "dashboard.widget.editTitleTitle": "Редагувати назву віджета",
  "dashboard.widget.editTitleLabel": "Назва віджета",
  "dashboard.widget.moveToTabEmpty": "Немає інших вкладок, куди можна перемістити цей віджет.",
  "dashboard.widget.menu.editTitle": "Редагувати заголовок",
  "dashboard.widget.menu.hide": "Приховати",
  "dashboard.widget.menu.remove": "Видалити",
  "dashboard.widget.provenanceChip": "ШІ",
  "dashboard.widget.expand": "Розгорнути віджет",
  "dashboard.widget.collapse": "Згорнути віджет",
  "dashboard.widget.moveHandle": "Перемістити віджет",
  "dashboard.widget.resizeHandle": "Змінити розмір віджета",
  "dashboard.widget.approval.approve": "Схвалити",
  "dashboard.widget.approval.reject": "Відхилити",
  "dashboard.widget.table.empty": "Немає рядків для відображення.",
  "dashboard.widget.table.more": "+{count} більше",
  "dashboard.widget.sessions.empty": "Сесій ще не було.",
  "dashboard.widget.usage.cost": "Вартість",
  "dashboard.widget.usage.tokens": "Токени",
  "dashboard.widget.cron.empty": "Немає запланованих завдань.",
  "dashboard.widget.cron.next": "Наступний: {time}",
  "dashboard.widget.cron.noNext": "Не заплановано",
  "dashboard.widget.instances.empty": "Немає підключених екземплярів.",
  "dashboard.widget.activity.empty": "Немає недавньої активності.",
  "dashboard.widget.approvals.approve": "Схвалити",
  "common.back": "Назад",
  "dashboard.history.actorUnknown": "Невідомо",
};

export default uk;
