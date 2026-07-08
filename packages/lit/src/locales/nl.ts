// nl strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const nl: BoardstateStrings = {
  "common.save": "Opslaan",
  "common.cancel": "Annuleren",
  "common.reload": "Opnieuw laden",
  "common.loading": "Laden…",
  "common.dismiss": "Sluiten",
  "dashboard.tabs.label": "Werkruimtes",
  "dashboard.tabs.hidden": "Verborgen ({count})",
  "dashboard.empty.onboardingTitle": "Nog geen werkruimtes",
  "dashboard.empty.tabTitle": "Deze werkruimte is leeg",
  "dashboard.widget.editTitleTitle": "Widgettitel bewerken",
  "dashboard.widget.editTitleLabel": "Widgettitel",
  "dashboard.widget.moveToTabEmpty":
    "Er zijn geen andere tabbladen om dit widget naar te verplaatsen.",
  "dashboard.widget.menu.editTitle": "Titel bewerken",
  "dashboard.widget.menu.hide": "Verbergen",
  "dashboard.widget.menu.remove": "Verwijderen",
  "dashboard.widget.expand": "Widget uitvouwen",
  "dashboard.widget.collapse": "Widget samenvouwen",
  "dashboard.widget.moveHandle": "Widget verplaatsen",
  "dashboard.widget.resizeHandle": "Grootte van widget wijzigen",
  "dashboard.widget.approval.approve": "Goedkeuren",
  "dashboard.widget.approval.reject": "Afwijzen",
  "dashboard.widget.table.empty": "Geen rijen om weer te geven.",
  "dashboard.widget.table.more": "+{count} meer",
  "dashboard.widget.sessions.empty": "Nog geen sessies.",
  "dashboard.widget.usage.cost": "Kosten",
  "dashboard.widget.cron.empty": "Geen geplande taken.",
  "dashboard.widget.cron.next": "Volgende {time}",
  "dashboard.widget.cron.noNext": "Niet gepland",
  "dashboard.widget.instances.empty": "Geen verbonden instanties.",
  "dashboard.widget.activity.empty": "Geen recente activiteit.",
  "dashboard.widget.approvals.approve": "Goedkeuren",
  "common.back": "Terug",
  "dashboard.history.actorUnknown": "Onbekend",
};

export default nl;
