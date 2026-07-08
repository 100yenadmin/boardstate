// pt-BR strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const pt_BR: BoardstateStrings = {
  "common.save": "Salvar",
  "common.cancel": "Cancelar",
  "common.reload": "Recarregar",
  "common.loading": "Carregando…",
  "common.dismiss": "Dispensar",
  "dashboard.tabs.label": "Espaços de trabalho",
  "dashboard.tabs.hidden": "Ocultos ({count})",
  "dashboard.empty.onboardingTitle": "Nenhum espaço de trabalho ainda",
  "dashboard.empty.tabTitle": "Este espaço de trabalho está vazio",
  "dashboard.widget.editTitleTitle": "Editar título do widget",
  "dashboard.widget.editTitleLabel": "Título do widget",
  "dashboard.widget.moveToTabEmpty": "Não há outras abas para mover este widget.",
  "dashboard.widget.menu.editTitle": "Editar título",
  "dashboard.widget.menu.hide": "Ocultar",
  "dashboard.widget.menu.remove": "Remover",
  "dashboard.widget.provenanceChip": "IA",
  "dashboard.widget.expand": "Expandir widget",
  "dashboard.widget.collapse": "Recolher widget",
  "dashboard.widget.moveHandle": "Mover widget",
  "dashboard.widget.resizeHandle": "Redimensionar widget",
  "dashboard.widget.approval.approve": "Aprovar",
  "dashboard.widget.approval.reject": "Rejeitar",
  "dashboard.widget.table.empty": "Nenhuma linha para exibir.",
  "dashboard.widget.table.more": "+{count} mais",
  "dashboard.widget.sessions.empty": "Nenhuma sessão ainda.",
  "dashboard.widget.usage.cost": "Custo",
  "dashboard.widget.cron.empty": "Nenhuma tarefa agendada.",
  "dashboard.widget.cron.next": "Próximo {time}",
  "dashboard.widget.cron.noNext": "Não agendado",
  "dashboard.widget.instances.empty": "Nenhuma instância conectada.",
  "dashboard.widget.activity.empty": "Nenhuma atividade recente.",
  "dashboard.widget.approvals.approve": "Aprovar",
  "common.back": "Voltar",
  "dashboard.history.actorUnknown": "Desconhecido",
};

export default pt_BR;
