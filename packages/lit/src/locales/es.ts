// es strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const es: BoardstateStrings = {
  "common.save": "Guardar",
  "common.cancel": "Cancelar",
  "common.reload": "Recargar",
  "common.loading": "Cargando…",
  "common.dismiss": "Descartar",
  "dashboard.tabs.label": "Espacios de trabajo",
  "dashboard.tabs.hidden": "Ocultos ({count})",
  "dashboard.empty.onboardingTitle": "Aún no hay espacios de trabajo",
  "dashboard.empty.tabTitle": "Este espacio de trabajo está vacío",
  "dashboard.widget.editTitleTitle": "Editar título del widget",
  "dashboard.widget.editTitleLabel": "Título del widget",
  "dashboard.widget.moveToTabEmpty": "No hay otras pestañas a las que mover este widget.",
  "dashboard.widget.menu.editTitle": "Editar título",
  "dashboard.widget.menu.hide": "Ocultar",
  "dashboard.widget.menu.remove": "Eliminar",
  "dashboard.widget.provenanceChip": "IA",
  "dashboard.widget.expand": "Expandir widget",
  "dashboard.widget.collapse": "Contraer widget",
  "dashboard.widget.moveHandle": "Mover widget",
  "dashboard.widget.resizeHandle": "Redimensionar widget",
  "dashboard.widget.approval.approve": "Aprobar",
  "dashboard.widget.approval.reject": "Rechazar",
  "dashboard.widget.table.empty": "No hay filas que mostrar.",
  "dashboard.widget.table.more": "+{count} más",
  "dashboard.widget.sessions.empty": "Aún no hay sesiones.",
  "dashboard.widget.usage.cost": "Costo",
  "dashboard.widget.cron.empty": "No hay trabajos programados.",
  "dashboard.widget.cron.next": "Próximo {time}",
  "dashboard.widget.cron.noNext": "No programado",
  "dashboard.widget.instances.empty": "No hay instancias conectadas.",
  "dashboard.widget.activity.empty": "Sin actividad reciente.",
  "dashboard.widget.approvals.approve": "Aprobar",
  "common.back": "Atrás",
  "dashboard.history.actorUnknown": "Desconocido",
};

export default es;
