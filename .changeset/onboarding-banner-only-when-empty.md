---
"@boardstate/lit": patch
---

The first-visit onboarding banner ("Add your first workspace") now only renders
while the workspace is genuinely unfurnished — no widgets on any tab. Previously
it sat on top of fully composed/seeded boards until manually dismissed.
