// tr strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const tr: BoardstateStrings = {
  "common.save": "Kaydet",
  "common.cancel": "İptal",
  "common.reload": "Yeniden yükle",
  "common.loading": "Yükleniyor…",
  "common.dismiss": "Kapat",
  "dashboard.tabs.label": "Çalışma Alanları",
  "dashboard.tabs.hidden": "Gizli ({count})",
  "dashboard.empty.onboardingTitle": "Henüz çalışma alanı yok",
  "dashboard.empty.tabTitle": "Bu çalışma alanı boş",
  "dashboard.widget.editTitleTitle": "Widget başlığını düzenle",
  "dashboard.widget.editTitleLabel": "Widget başlığı",
  "dashboard.widget.moveToTabEmpty": "Bu widget'ı taşıyacak başka bir sekme yok.",
  "dashboard.widget.menu.editTitle": "Başlığı düzenle",
  "dashboard.widget.menu.hide": "Gizle",
  "dashboard.widget.menu.remove": "Kaldır",
  "dashboard.widget.provenanceChip": "Yapay Zeka",
  "dashboard.widget.expand": "Widget'ı genişlet",
  "dashboard.widget.collapse": "Widget'ı daralt",
  "dashboard.widget.moveHandle": "Widget'ı taşı",
  "dashboard.widget.resizeHandle": "Widget'ı yeniden boyutlandır",
  "dashboard.widget.approval.approve": "Onayla",
  "dashboard.widget.approval.reject": "Reddet",
  "dashboard.widget.table.empty": "Gösterilecek satır yok.",
  "dashboard.widget.table.more": "+{count} daha fazla",
  "dashboard.widget.sessions.empty": "Henüz oturum yok.",
  "dashboard.widget.usage.cost": "Maliyet",
  "dashboard.widget.usage.tokens": "Tokenlar",
  "dashboard.widget.cron.empty": "Zamanlanmış iş yok.",
  "dashboard.widget.cron.next": "Sonraki {time}",
  "dashboard.widget.cron.noNext": "Zamanlanmadı",
  "dashboard.widget.instances.empty": "Bağlı örnek yok.",
  "dashboard.widget.activity.empty": "Son etkinlik yok.",
  "dashboard.widget.approvals.approve": "Onayla",
  "common.back": "Geri",
  "dashboard.history.actorUnknown": "Bilinmiyor",
};

export default tr;
