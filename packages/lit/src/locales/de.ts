// de strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const de: BoardstateStrings = {
  "common.save": "Speichern",
  "common.cancel": "Abbrechen",
  "common.reload": "Neu laden",
  "common.loading": "Wird geladen…",
  "common.dismiss": "Schließen",
  "dashboard.tabs.label": "Arbeitsbereiche",
  "dashboard.tabs.hidden": "Ausgeblendet ({count})",
  "dashboard.empty.onboardingTitle": "Noch keine Arbeitsbereiche",
  "dashboard.empty.tabTitle": "Dieser Arbeitsbereich ist leer",
  "dashboard.widget.editTitleTitle": "Widget-Titel bearbeiten",
  "dashboard.widget.editTitleLabel": "Widget-Titel",
  "dashboard.widget.moveToTabEmpty":
    "Es gibt keine anderen Tabs, in die dieses Widget verschoben werden kann.",
  "dashboard.widget.menu.editTitle": "Titel bearbeiten",
  "dashboard.widget.menu.hide": "Ausblenden",
  "dashboard.widget.menu.remove": "Entfernen",
  "dashboard.widget.provenanceChip": "KI",
  "dashboard.widget.expand": "Widget ausklappen",
  "dashboard.widget.collapse": "Widget einklappen",
  "dashboard.widget.moveHandle": "Widget verschieben",
  "dashboard.widget.resizeHandle": "Widgetgröße ändern",
  "dashboard.widget.approval.approve": "Genehmigen",
  "dashboard.widget.approval.reject": "Ablehnen",
  "dashboard.widget.table.empty": "Keine Zeilen zum Anzeigen.",
  "dashboard.widget.table.more": "+{count} weitere",
  "dashboard.widget.sessions.empty": "Noch keine Sitzungen.",
  "dashboard.widget.usage.cost": "Kosten",
  "dashboard.widget.cron.empty": "Keine geplanten Aufgaben.",
  "dashboard.widget.cron.next": "Nächste: {time}",
  "dashboard.widget.cron.noNext": "Nicht geplant",
  "dashboard.widget.instances.empty": "Keine verbundenen Instanzen.",
  "dashboard.widget.activity.empty": "Keine aktuellen Aktivitäten.",
  "dashboard.widget.approvals.approve": "Genehmigen",
  "common.back": "Zurück",
  "dashboard.history.actorUnknown": "Unbekannt",
};

export default de;
