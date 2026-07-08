// id strings for the Boardstate reference view.
// Ported from the source project's Control-UI locale bundle; only keys whose
// English source matched Boardstate's English table verbatim were carried over,
// so every value is a faithful translation of the string it replaces. Unlisted
// keys fall back to the built-in English.
import type { BoardstateStrings } from "../strings.js";

export const id: BoardstateStrings = {
  "common.save": "Simpan",
  "common.cancel": "Batal",
  "common.reload": "Muat ulang",
  "common.loading": "Memuat…",
  "common.dismiss": "Tutup",
  "dashboard.tabs.label": "Ruang Kerja",
  "dashboard.tabs.hidden": "Tersembunyi ({count})",
  "dashboard.empty.onboardingTitle": "Belum ada ruang kerja",
  "dashboard.empty.tabTitle": "Ruang kerja ini kosong",
  "dashboard.widget.editTitleTitle": "Edit judul widget",
  "dashboard.widget.editTitleLabel": "Judul widget",
  "dashboard.widget.moveToTabEmpty": "Tidak ada tab lain untuk memindahkan widget ini.",
  "dashboard.widget.menu.editTitle": "Edit judul",
  "dashboard.widget.menu.hide": "Sembunyikan",
  "dashboard.widget.menu.remove": "Hapus",
  "dashboard.widget.expand": "Perluas widget",
  "dashboard.widget.collapse": "Ciutkan widget",
  "dashboard.widget.moveHandle": "Pindahkan widget",
  "dashboard.widget.resizeHandle": "Ubah ukuran widget",
  "dashboard.widget.approval.approve": "Setujui",
  "dashboard.widget.approval.reject": "Tolak",
  "dashboard.widget.table.empty": "Tidak ada baris untuk ditampilkan.",
  "dashboard.widget.table.more": "+{count} lainnya",
  "dashboard.widget.sessions.empty": "Belum ada sesi.",
  "dashboard.widget.usage.cost": "Biaya",
  "dashboard.widget.usage.tokens": "Token",
  "dashboard.widget.cron.empty": "Tidak ada tugas terjadwal.",
  "dashboard.widget.cron.next": "Berikutnya {time}",
  "dashboard.widget.cron.noNext": "Tidak dijadwalkan",
  "dashboard.widget.instances.empty": "Tidak ada instance yang terhubung.",
  "dashboard.widget.activity.empty": "Tidak ada aktivitas terbaru.",
  "dashboard.widget.approvals.approve": "Setujui",
  "common.back": "Kembali",
  "dashboard.history.actorUnknown": "Tidak diketahui",
};

export default id;
