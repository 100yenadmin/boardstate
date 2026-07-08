// fr strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const fr: BoardstateStrings = {
  "common.save": "Enregistrer",
  "common.cancel": "Annuler",
  "common.reload": "Recharger",
  "common.loading": "Chargement…",
  "common.dismiss": "Ignorer",
  "dashboard.tabs.label": "Espaces de travail",
  "dashboard.tabs.hidden": "Masqués ({count})",
  "dashboard.empty.onboardingTitle": "Aucun espace de travail pour le moment",
  "dashboard.empty.tabTitle": "Cet espace de travail est vide",
  "dashboard.widget.editTitleTitle": "Modifier le titre du widget",
  "dashboard.widget.editTitleLabel": "Titre du widget",
  "dashboard.widget.moveToTabEmpty": "Il n'y a pas d'autres onglets où déplacer ce widget.",
  "dashboard.widget.menu.editTitle": "Modifier le titre",
  "dashboard.widget.menu.hide": "Masquer",
  "dashboard.widget.menu.remove": "Supprimer",
  "dashboard.widget.provenanceChip": "IA",
  "dashboard.widget.expand": "Développer le widget",
  "dashboard.widget.collapse": "Réduire le widget",
  "dashboard.widget.moveHandle": "Déplacer le widget",
  "dashboard.widget.resizeHandle": "Redimensionner le widget",
  "dashboard.widget.approval.approve": "Approuver",
  "dashboard.widget.approval.reject": "Refuser",
  "dashboard.widget.table.empty": "Aucune ligne à afficher.",
  "dashboard.widget.table.more": "+{count} de plus",
  "dashboard.widget.sessions.empty": "Aucune session pour le moment.",
  "dashboard.widget.usage.cost": "Coût",
  "dashboard.widget.usage.tokens": "Jetons",
  "dashboard.widget.cron.empty": "Aucune tâche planifiée.",
  "dashboard.widget.cron.next": "Prochain {time}",
  "dashboard.widget.cron.noNext": "Non planifié",
  "dashboard.widget.instances.empty": "Aucune instance connectée.",
  "dashboard.widget.activity.empty": "Aucune activité récente.",
  "dashboard.widget.approvals.approve": "Approuver",
  "common.back": "Retour",
  "dashboard.history.actorUnknown": "Inconnu",
};

export default fr;
