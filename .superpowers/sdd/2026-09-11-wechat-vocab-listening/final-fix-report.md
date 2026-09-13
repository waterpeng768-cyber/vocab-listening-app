# WeChat Vocabulary Listening Final Fix Report

Date: 2026-09-13

## Scope

Completed the whole-branch final fixes from head `d4afdbd` without pushing or merging.
The implementation commits are:

- `6854d1006f807e473f7af693439240466a92339f`
  (`fix: harden vocabulary persistence and lookup`)
- `62a4d24232f503015aa00d8a9c18dfa511633524`
  (`fix: reject untrusted generic audio labels`)

## Fixes

1. Storage sanitation now repairs duplicate IDs deterministically after load,
   migration, and import while preserving valid rows. Importing two different
   words with the same ID and deleting one now leaves the other intact.
2. Saved words retain IPA accent, American-audio provenance, and warnings.
   Generic IPA always regains its visible review warning, and unlabeled generic
   candidate audio is discarded instead of being treated as American.
3. Editing a lookup-populated phonetic or meaning changes `source` and
   `confidence` to `manual`; phonetic edits also change the IPA accent to
   `manual`. Existing generic-IPA warnings remain visible.
4. The visible speed choices are exactly `0.6`, `0.8`, `1`, and `1.2`.
   Loaded and saved rates are clamped through the same supported-rate rule.
5. Normal page lookup now uses a versioned cache. Cache hits skip the provider;
   misses call the provider and write the result. Old versions and malformed
   entries are ignored, and cache failures cannot block a live lookup.
6. Added explicit protection that a valid empty current word array is
   authoritative over legacy storage.
7. Corrected generic-IPA audio trust at both persistence and cache boundaries.
   A caller-supplied `audioAccent: "us"` cannot authorize an arbitrary URL.
   Generic IPA retains audio only when the URL exactly matches the configured
   Youdao `type=2` fallback for the same normalized word. Poisoned cache entries
   are ignored and replaced by a fresh provider result.

The existing `tool` `/tul/` and Chinese-meaning regression, American-only audio
selection, hidden-answer workflow, manual fallback, rename collision behavior,
and single audio-context tests remain in the passing suite.

## TDD Evidence

- Baseline: `70/70` tests passed at `d4afdbd`.
- RED batch: `34/46` passed and `12` failed for the newly exposed behaviors.
  Failures matched missing accent/audio provenance, missing cached lookup,
  wrong visible rate, unchanged edit provenance, duplicate IDs, unclamped
  storage rates, and the unversioned cache.
- Additional RED: the old generic candidate-audio regression failed `0/1`
  because the URL was still retained.
- Scoped correction RED: `0/2` tests passed. Persistence retained an arbitrary
  generic URL carrying a fake `us` flag, and cached lookup returned the same
  poisoned entry instead of calling the provider.
- Scoped correction focused GREEN: `31/31` storage and dictionary tests passed.
- Focused GREEN: `48/48` storage, dictionary, page-helper, page-handler, and
  review tests passed.
- Final full GREEN: `85/85` tests passed with no failures, skips, or todos.

## Changed Files

- `wechat-miniprogram/pages/index/index.js`
- `wechat-miniprogram/pages/index/page-helpers.js`
- `wechat-miniprogram/services/dictionary.js`
- `wechat-miniprogram/utils/storage.js`
- `wechat-miniprogram/tests/dictionary.test.js`
- `wechat-miniprogram/tests/page-handlers.test.js`
- `wechat-miniprogram/tests/page-helpers.test.js`
- `wechat-miniprogram/tests/review.test.js`
- `wechat-miniprogram/tests/storage.test.js`
- `.superpowers/sdd/2026-09-11-wechat-vocab-listening/final-fix-report.md`

## Verification

- Node tests: `85/85` passed.
- JavaScript syntax: `21` files passed `node --check`.
- JSON parse: `5` files passed.
- Empty-file scan: no empty files in `wechat-miniprogram/`.
- `git diff --check`: passed.
- Dependency check: no runtime or development dependencies added.
- Scope check: implementation changes stayed under `wechat-miniprogram/`;
  root `index.html`, `icon.svg`, `manifest.webmanifest`, and
  `service-worker.js` are unchanged.

## ZIP

- Path: `C:\Users\pengs\Documents\Codex\2026-06-24\vocab-listening-wechat-miniprogram.zip`
- Size: `37,942` bytes
- Files: `30`
- SHA-256: `dd6d964a42406d87d71ed90eb2f6b1600a38f00e3e5641a07194a945ebb0afd8`
- Verification: every ZIP file entry matched its source file by SHA-256.

No push or merge was performed.
