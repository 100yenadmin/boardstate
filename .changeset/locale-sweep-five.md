---
"@boardstate/lit": patch
---

i18n(lit): complete ja-JP, zh-CN, de, es, fr locale tables (#12)

`packages/lit/src/locales/*.ts` shipped ~34 translated core-chrome keys per
language; every later-wave key (history, gallery, preview, agent status,
approvals, chat, distribution, action-button) fell back to English for all 20
locales. This locale sweep fills **ja-JP, zh-CN, de, es, and fr** to 100%
coverage of `BoardstateStringKey` (177/177 keys each) with UI-register
translations that match each file's existing terminology and formality —
placeholders (`{name}`-style) preserved exactly, technical loanwords
(gateway/sandbox/token) handled per language convention. The other 15 shipped
locales are untouched and keep falling back to English for the new keys.

Adds `packages/lit/src/locales.test.ts`, asserting these five locales cover
every key in the English source table (and preserve every placeholder token),
so a future key added to `strings.ts` without a matching translation fails
the test loudly instead of silently falling back to English in these five
locales.
