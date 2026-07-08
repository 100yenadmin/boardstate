// pl strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const pl: BoardstateStrings = {
  "common.save": "Zapisz",
  "common.cancel": "Anuluj",
  "common.reload": "Przeładuj",
  "common.loading": "Ładowanie…",
  "common.dismiss": "Odrzuć",
  "dashboard.tabs.label": "Obszary robocze",
  "dashboard.tabs.hidden": "Ukryte ({count})",
  "dashboard.empty.onboardingTitle": "Brak obszarów roboczych",
  "dashboard.empty.tabTitle": "Ten obszar roboczy jest pusty",
  "dashboard.widget.editTitleTitle": "Edytuj tytuł widżetu",
  "dashboard.widget.editTitleLabel": "Tytuł widżetu",
  "dashboard.widget.moveToTabEmpty": "Nie ma innych kart, do których można przenieść ten widżet.",
  "dashboard.widget.menu.editTitle": "Edytuj tytuł",
  "dashboard.widget.menu.hide": "Ukryj",
  "dashboard.widget.menu.remove": "Usuń",
  "dashboard.widget.expand": "Rozwiń widżet",
  "dashboard.widget.collapse": "Zwiń widżet",
  "dashboard.widget.moveHandle": "Przesuń widżet",
  "dashboard.widget.resizeHandle": "Zmień rozmiar widżetu",
  "dashboard.widget.approval.approve": "Zatwierdź",
  "dashboard.widget.approval.reject": "Odrzuć",
  "dashboard.widget.table.empty": "Brak wierszy do wyświetlenia.",
  "dashboard.widget.table.more": "+{count} więcej",
  "dashboard.widget.sessions.empty": "Brak sesji.",
  "dashboard.widget.usage.cost": "Koszt",
  "dashboard.widget.usage.tokens": "Tokeny",
  "dashboard.widget.cron.empty": "Brak zaplanowanych zadań.",
  "dashboard.widget.cron.next": "Następny {time}",
  "dashboard.widget.cron.noNext": "Nie zaplanowano",
  "dashboard.widget.instances.empty": "Brak połączonych instancji.",
  "dashboard.widget.activity.empty": "Brak ostatniej aktywności.",
  "dashboard.widget.approvals.approve": "Zatwierdź",
  "common.back": "Wstecz",
  "dashboard.history.actorUnknown": "Nieznany",
};

export default pl;
