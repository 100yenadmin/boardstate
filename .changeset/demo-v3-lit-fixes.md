---
"@boardstate/lit": patch
---

Fix a batch of reference-view defects (demo v3):

1. Modal card overflow — `.bs-modal__card` now sizes to content with viewport
   rails (`max-width`/`max-height: calc(100vh/100vw - 48px)` + `overflow: auto`),
   so the gallery and history dialogs no longer clip on narrow viewports.
2. Primary buttons — re-assert the accent surface in the Graphite polish block;
   the later `.bs-btn` reset had reverted primary buttons to white-on-white in
   light mode.
3. Modal scrim — deepen to 60% black and add a `backdrop-filter: blur(3px)`.
4. Add `color-scheme` (light on `:root`, dark on both dark blocks) so native
   scrollbars/controls match the theme.
5. Custom-widget frame `min-height` 160px → 120px so an `h:3` cell no longer
   forces host scroll.
6. Action-form — a rejected prompt dispatch now surfaces on the shared toast
   (`onActionError` → `state.actionError`) instead of being swallowed.
7. RTL — `.dashboard-page-header__action-icon` uses `margin-inline-end`.
8. Add minimal spacing rules for previously unstyled dialog classes
   (`.dashboard-gallery__header`, `.dashboard-gallery__item-body`,
   `.dashboard-history__diff-label`, `.dashboard-history__preview-wrap`).
- RTL: per-element `unicode-bidi: plaintext` so untranslated English runs keep their punctuation on the correct side inside `dir="rtl"` pages.
