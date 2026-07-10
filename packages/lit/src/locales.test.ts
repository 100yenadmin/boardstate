// Locale completeness test (issue #12 — the locale sweep). ja-JP, zh-CN, de, es,
// and fr are maintained at 100% coverage of BoardstateStringKey: every key in the
// English source table must have a translation in each of these five locale
// tables. Without this test, a key added to strings.ts later would silently fall
// back to English in these locales instead of failing the build loudly.
//
// Lives outside src/locales/ deliberately: tsdown.config.ts globs
// `src/locales/*.ts` as individual multi-entry build targets (one per shipped
// locale, matching the package's `./locales/*` export), so a `*.test.ts` file
// placed inside that directory gets swept into the published dist output.
//
// The other 15 shipped locales are intentionally partial (core-chrome keys only)
// and are not covered by this test — see CONTRIBUTING.md / issue #12.
import { describe, expect, it } from "vitest";
import { en, type BoardstateStringKey, type BoardstateStrings } from "./strings.js";
import de from "./locales/de.js";
import es from "./locales/es.js";
import fr from "./locales/fr.js";
import jaJP from "./locales/ja-JP.js";
import zhCN from "./locales/zh-CN.js";

const FULL_KEYS = Object.keys(en) as BoardstateStringKey[];

const COMPLETE_LOCALES: Record<string, BoardstateStrings> = {
  "ja-JP": jaJP,
  "zh-CN": zhCN,
  de,
  es,
  fr,
};

/** Extract the sorted set of `{token}` interpolation names from a string. */
function placeholderTokens(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

describe("locale completeness (#12)", () => {
  for (const [locale, table] of Object.entries(COMPLETE_LOCALES)) {
    it(`${locale} has a translation for every BoardstateStringKey`, () => {
      const missing = FULL_KEYS.filter((key) => table[key] === undefined);
      expect(missing).toEqual([]);
    });

    it(`${locale} has no blank translations`, () => {
      const blank = FULL_KEYS.filter((key) => table[key] === "");
      expect(blank).toEqual([]);
    });

    it(`${locale} preserves every {placeholder} token from the English source`, () => {
      const mismatched = FULL_KEYS.filter((key) => {
        const translated = table[key];
        if (translated === undefined) return false; // reported by the coverage test above
        return placeholderTokens(en[key]).join(",") !== placeholderTokens(translated).join(",");
      });
      expect(mismatched).toEqual([]);
    });
  }
});
