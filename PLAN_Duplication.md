# Tighten Duplicate Matching Without Expanding Scope

## Summary
The audit supports the main concern in plain terms: VideoCull is currently a bit too forgiving in a few important places, so it can over-group videos that are only similar rather than truly duplicates. The plan below fixes the strongest code-backed causes first and avoids broader changes you did not choose for this round.

The report itself stays unchanged for now. The plan also does **not** include benchmark automation in this round, so the outcome should be described as a product-safety improvement, not as proof that VideoCull now beats VDF.

## Key Changes
- Tighten duration matching logic in the shared duplicate comparison helper.
  Change the tolerance base from the longer video to the shorter video.
  Keep `durationTolerancePercent` at `20` for now.
  Apply this shared rule to both visual and pHash duplicate modes.

- Make per-sample matching stricter by default.
  Change the default `requireEverySample` from `false` to `true` in both the Electron-side duplicate defaults and the renderer-side mirrored defaults.
  Keep the user setting exposed; do not force-migrate existing saved preferences.
  Keep `finalSimilarityThreshold` at `95` and `sampleCount` at `3`.

- Add automatic dark-sample skipping in duplicate scoring.
  Reuse stored `frame_dark_ratio` and treat a sample as dark when `frame_dark_ratio >= 0.80`.
  Extend cached row loading so both visual and pHash workers receive dark-ratio metadata.
  Exclude sample positions from scoring when either side’s sampled frame is dark.
  If `sampleCount > 1`, require at least `2` usable sample positions after dark-sample filtering; otherwise return no match.
  Do not add a new user-facing setting for this round.

- Strengthen daisy-chain cleanup only where it matters.
  Keep the current fast first-pass pair generation.
  For groups that enter daisy-chain validation (`3+` members), recompute pair similarity during cleanup instead of trusting cached pair scores.
  Recompute with the active comparison mode and current settings, using cached sample data rather than original worker scores.
  Restrict this recomputation to groups being pruned/split, not every group.

- Make the duplicate UI safer without adding new confidence systems.
  Use existing `matchType` to visually separate exact-file matches from similarity-based matches.
  Label non-exact groups as “Potential duplicates”.
  Keep exact-file groups clearly labeled as exact matches.
  Update high-risk wording in the duplicate actions where needed so deletion remains obviously user-confirmed, not automatic.
  Do not add confidence tiers or per-sample score UI in this round.

## Public Behavior / Interface Impact
- Default duplicate behavior becomes stricter for new or unset configs because `requireEverySample` defaults to `true`.
- Duration matching becomes stricter without changing the visible `20%` setting.
- Dark/black sampled frames stop contributing to duplicate scoring automatically.
- Duplicate results UI distinguishes exact matches from similarity-based matches more clearly.
- No new settings, no new presets, and no report edits in this round.

## Test Plan
- Update duplicate default tests to assert `requireEverySample === true` and unchanged defaults for threshold, duration percent, and sample count.
- Add unit tests for duration tolerance using shorter-duration base, including the `60s` vs `48s` case.
- Add worker tests covering dark-sample skipping:
  pairs with one dark sample and two good samples still match only when usable samples pass.
  pairs with too few usable samples do not match.
  unknown-duration behavior remains unchanged except for the stricter sample rules.
- Add grouping tests showing daisy-chain cleanup rechecks similarity for `3+` member groups and drops weak chain members based on recomputed scores.
- Manually verify UI behavior:
  exact groups render separately/labeled as exact.
  non-exact groups render as potential duplicates.
  existing selection and dismissal flows still work.

## Assumptions
- Existing stored user settings are preserved; stricter defaults apply only where the value is unset.
- Sample count stays at `3`.
- Similarity threshold stays at `95`.
- Duration tolerance setting stays at `20%`; only the calculation base changes.
- No benchmark suite, no VDF side-by-side automation, and no rewrite of `videocull_vs_vdf_comparison.md` in this round.

## Recommended PR / Commit Order

1. **Shared defaults and duration rule**
   - Change `requireEverySample` default to `true` in both duplicate default sources.
   - Change duration tolerance to use the shorter video as the percentage base.
   - Add or update unit tests for defaults and duration behavior first.
   - Suggested commit type: `fix`

2. **Dark-sample filtering in workers**
   - Extend cached fingerprint row loading so both duplicate modes receive `frame_dark_ratio`.
   - Add dark-sample skipping to both pHash and visual worker scoring.
   - Enforce the minimum usable-sample rule after dark-sample filtering.
   - Add worker tests for dark samples and too-few-usable-samples cases.
   - Suggested commit type: `fix`

3. **Daisy-chain cleanup recheck**
   - Keep the fast first-pass matching unchanged.
   - Recompute similarity only during daisy-chain cleanup for `3+` member groups being validated.
   - Add grouping tests showing weak chain members are dropped when recomputed similarity fails.
   - Suggested commit type: `fix`

4. **Duplicate UI labeling and wording**
   - Clearly label exact groups as exact matches.
   - Clearly label similarity-based groups as potential duplicates.
   - Tighten risky wording in duplicate actions where needed without changing the overall workflow.
   - Manually verify selection, dismissal, and review/play flows still behave the same.
   - Suggested commit type: `feat` if user-facing labels change noticeably, otherwise `fix`
