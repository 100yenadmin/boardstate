// it strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const it: BoardstateStrings = {
  "common.save": "Salva",
  "common.cancel": "Annulla",
  "common.reload": "Ricarica",
  "common.loading": "Caricamento…",
  "common.dismiss": "Ignora",
  "dashboard.tabs.label": "Aree di lavoro",
  "dashboard.tabs.hidden": "Nascoste ({count})",
  "dashboard.empty.onboardingTitle": "Ancora nessuna area di lavoro",
  "dashboard.empty.tabTitle": "Questa area di lavoro è vuota",
  "dashboard.widget.editTitleTitle": "Modifica titolo widget",
  "dashboard.widget.editTitleLabel": "Titolo widget",
  "dashboard.widget.moveToTabEmpty": "Non ci sono altre schede in cui spostare questo widget.",
  "dashboard.widget.menu.editTitle": "Modifica titolo",
  "dashboard.widget.menu.hide": "Nascondi",
  "dashboard.widget.menu.remove": "Rimuovi",
  "dashboard.widget.expand": "Espandi widget",
  "dashboard.widget.collapse": "Comprimi widget",
  "dashboard.widget.moveHandle": "Sposta widget",
  "dashboard.widget.resizeHandle": "Ridimensiona widget",
  "dashboard.widget.approval.approve": "Approva",
  "dashboard.widget.approval.reject": "Rifiuta",
  "dashboard.widget.table.empty": "Nessuna riga da mostrare.",
  "dashboard.widget.table.more": "+{count} in più",
  "dashboard.widget.sessions.empty": "Nessuna sessione al momento.",
  "dashboard.widget.usage.cost": "Costo",
  "dashboard.widget.usage.tokens": "Token",
  "dashboard.widget.cron.empty": "Nessun processo pianificato.",
  "dashboard.widget.cron.next": "Prossimo {time}",
  "dashboard.widget.cron.noNext": "Non pianificato",
  "dashboard.widget.instances.empty": "Nessuna istanza connessa.",
  "dashboard.widget.activity.empty": "Nessuna attività recente.",
  "dashboard.widget.approvals.approve": "Approva",
  "common.back": "Indietro",
  "dashboard.history.actorUnknown": "Sconosciuto",
};

export default it;
