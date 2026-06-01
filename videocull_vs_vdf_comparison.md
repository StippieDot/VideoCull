# VideoCull vs VDF Duplicate Detection Comparison

---

## 1. Verdict

> [!IMPORTANT]
> **VideoCull is more false-positive prone than VDF.**

The evidence is not mixed — it is structurally clear from the code. VideoCull's defaults and algorithm design create multiple overlapping vectors for false positives that VDF either avoids entirely or mitigates more aggressively:

| Factor | VideoCull | VDF | Impact |
|--------|-----------|-----|--------|
| Default sample count | **3** | **1** (default `ThumbnailCount`) | Lower samples = less discriminative power, but VDF compensates via stricter threshold |
| Default similarity threshold | **95%** | **96%** (`Percent = 96f`) | 1% matters enormously at the margin |
| pHash comparison scope | All samples averaged | **Only first sample** (single-position gate) | VDF's single-sample pHash is a harder gate — one mismatch kills the match |
| Duration tolerance | **20%** of *longer* video | **20%** of *shorter* video (`Math.Min` of both) | VDF is significantly stricter on duration — see §6 |
| Unknown-duration handling | Bypasses duration filter, compares against **each other** | **Requires valid `mediaInfo`** — excluded from scan entirely | VideoCull can match zero-duration / corrupt files |
| Black frame detection | **No default mitigation** (`ignoreBlackPixels: false`) | **Rejects "too dark" files** (`VerifyGrayScaleValues`, 80% dark threshold → `EntryFlags.TooDark`) | VDF preemptively removes black-frame videos from the pool |
| Group merge validation | Representative-based check + daisy-chain pruning post-hoc | Representative-based check **inline during merge** + daisy-chain pruning post-hoc | Similar, but VDF re-validates in `SplitDaisyChainGroups` with full pairwise recompare |
| `requireEverySample` default | **`false`** — average can mask one bad sample | N/A (VDF uses sum-of-diff with early exit) | A single matching sample can carry two mismatches in VideoCull |
| Exact duplicate detection | File hash (SHA-256) — correct | **No separate exact-duplicate pass** | VideoCull is better here — VDF relies solely on visual similarity for exact matches |

**Bottom line**: Your suspicion is correct. VideoCull, with its default settings, will produce more false positives than VDF running with its defaults. The key drivers are the looser duration tolerance calculation, the lack of dark-frame exclusion, and the averaging of similarity scores across samples without requiring per-sample minimums.

---

## 2. Algorithm Comparison Table

| Dimension | VideoCull | VDF |
|-----------|-----------|-----|
| **Fingerprint type** | DCT-based pHash (64-bit, skip DC) OR 32×32 grayscale pixel comparison | DCT-based pHash (64-bit, skip DC) OR 32×32 grayscale pixel comparison |
| **pHash implementation** | JavaScript BigInt, 63-bit hash (skips DC, `comparable.slice(1)`) | C# `ulong`, 64-bit hash (K×K=8×8=64 AC coefficients, skips DC row/col) |
| **pHash bit count** | Uses 63 bits (bit 63 always 0) with similarity = `(64-hamming)/64 × 100` | Uses 64 bits with similarity = `1 - hamming/64` |
| **Frame resolution** | 32×32 grayscale (`scale=32:32:flags=bicubic,format=gray`) | 32×32 grayscale (same FFmpeg pipeline) |
| **Frame sampling strategy** | Evenly spaced within configurable window; `i/(count+1)` ratio; default 3 samples | `positionCounter += 1/(count+1)` ratio; default **1 sample** |
| **Threshold model** | Average similarity ≥ threshold (default 95%); optional `requireEverySample` | Sum-of-difference ≤ limit × sampleCount (default 96%, expressed as `1 - Percent/100`); pHash mode: strict floor on Hamming bits |
| **Duration handling** | `Math.max(durationA, durationB) × tolerance%` — tolerance based on **longer** video | `Math.Min(toleranceA, toleranceB)` — tolerance based on **shorter** video |
| **Duration default** | 20% | 20% (but applied more conservatively due to `Min`) |
| **Grouping method** | Union-find via sorted pairs → daisy-chain pruning post-hoc | Sequential merge into `duplicateDict` with representative gate → daisy-chain pruning post-hoc |
| **Exact duplicate path** | ✅ Separate: size-bucket → quick SHA-256 (head+middle) → full SHA-256 | ❌ None — relies on visual similarity |
| **Visual duplicate path** | pHash mode (Hamming distance) or visual mode (pixel MAE) | pHash mode (Hamming distance, first sample only) or grayscale mode (pixel MAE, all samples) |
| **False-positive controls** | Representative gate on group join/merge; daisy-chain pruning; ignored-pair list | Representative gate on group join/merge; dark-frame exclusion; daisy-chain pruning; hard-link exclusion |
| **False-negative risks** | Dark/black frames treated as similar content; strict 95% can miss re-encoded content | Single-sample default misses videos that only differ in one region; dark-frame exclusion can reject valid dark content |
| **Scalability** | Worker threads; duration bucketing (activated at 5000+ videos) | `Parallel.ForEach`; duration bucketing (activated at 5000+ videos) |
| **Partial clip detection** | ❌ Not implemented | ✅ Audio fingerprint sliding-window + optional visual gate |

---

## 3. False Positive Risk Analysis

### VideoCull false-positive vectors

1. **Loose duration tolerance (HIGH RISK)**
   - [durationsWithinTolerance](file:///d:/GitHub/Video-Cull/electron/duplicate-utils.js#L223-L230): uses `Math.max(durationA, durationB)` as base.
   - A 60s video compared to a 48s video: tolerance = `60 × 0.20 = 12s`, diff = 12s → **passes**.
   - VDF's `Math.Min`: tolerance = `min(60×0.20, 48×0.20) = 9.6s`, diff = 12s → **fails**.
   - This single difference means VideoCull considers pairs with up to 20% duration difference (relative to the *longer* one), while VDF uses 20% of the *shorter* one.

2. **Average-based similarity with `requireEverySample: false` (HIGH RISK)**
   - With 3 samples, scores of [100, 100, 85] average to 95% → **passes threshold**.
   - That 85% sample may represent a completely different scene (intro/outro, different clip).
   - VDF's sum-of-diff early exit would reject this pair faster.

3. **No dark-frame exclusion (MEDIUM RISK)**
   - `ignoreBlackPixels: false` by default.
   - Two unrelated videos with black intros/outros at sample positions → all-dark frames compare as highly similar.
   - VDF rejects files where ≥80% of pixels are dark (`VerifyGrayScaleValues` → `EntryFlags.TooDark`).

4. **Zero/unknown-duration videos compared against each other (MEDIUM RISK)**
   - [duplicate-worker.js L121-L127](file:///d:/GitHub/Video-Cull/electron/duplicate-worker.js#L121-L127): unknown-duration videos are compared only against each other, bypassing duration bucketing. But they still bypass the duration tolerance check entirely (`durationsWithinTolerance` returns `true` if either duration ≤ 0).
   - Corrupted or metadata-less files of completely different content can match.

5. **Graph-based grouping + daisy-chain pruning gap (MEDIUM RISK)**
   - Groups are built by merging pairs sorted by similarity (highest first). Two unrelated videos can end up in the same group if each shares a high-scoring pair with a bridging video.
   - The `pruneWeakDaisyChainMembers` function requires `connections ≥ ceil((active.length - 1) / 2)`. For a group of 3 items, that's 1 connection. A video connected to just 1 of 2 others survives.

6. **pHash similarity ceiling (LOW RISK)**
   - 63-bit hash gives 64 possible Hamming distances. At 95% threshold: `(64 - d) / 64 ≥ 0.95` → `d ≤ 3.2` → `d ≤ 3`. Only 3 bit flips allowed. This is actually reasonably tight, but the averaging across samples weakens it.

### VDF false-positive vectors

1. **Single-sample default in pHash mode (LOW-MEDIUM RISK)**
   - With `ThumbnailCount = 1` and `UsePHashing = true`, only one frame is compared. Two videos that happen to have similar frames at the 50% mark but differ everywhere else would match.
   - Mitigated by the higher 96% default threshold.

2. **Grayscale mode (non-pHash) with 1 sample (MEDIUM RISK)**
   - Same problem as above, but grayscale pixel MAE is more sensitive to noise than pHash, so one matching frame is a weaker signal.

3. **Silent audio fingerprint → partial clip false positives (LOW RISK, mitigated)**
   - VDF explicitly detects and excludes silent/all-zero fingerprints (`IsSilentFingerprint`). This is well-handled.

### Risk ranking

| Rank | App | Risk |
|------|-----|------|
| 1 (highest) | **VideoCull** | Loose duration tolerance allows matching different-length clips |
| 2 | **VideoCull** | Average-based scoring masks individual sample mismatches |
| 3 | **VideoCull** | No dark-frame exclusion → black frame matches |
| 4 | **VideoCull** | Unknown-duration bypass |
| 5 | VDF | Single-sample default can match on one coincidental frame |

---

## 4. False Negative Risk Analysis

### VideoCull false-negative risks

1. **95% threshold too strict for re-encoded content (LOW RISK)**
   - Re-encoding with different codecs/settings typically produces pHash similarity of 90-97%. The 95% default catches most but may miss aggressive re-encodes.

2. **Duration tolerance too strict for trimmed content (MEDIUM RISK)**
   - A video trimmed by 25% won't match because 25% > 20% tolerance. However, this is intentional — trimmed videos aren't duplicates in the strict sense.

3. **Sampling window misalignment for short videos (LOW RISK)**
   - For very short videos (< 3s), `getSamplingTimestamps` returns `[0]` if duration is 0 or invalid. Short valid videos get compressed sample positions that may all land on the same visual region.

### VDF false-negative risks

1. **Single-sample default misses content variations (MEDIUM RISK)**
   - With only 1 sample at 50%, two identical videos where one has a different frame at that exact position (overlay, watermark, subtitle) will be missed.

2. **Dark-frame exclusion rejects legitimate dark content (LOW-MEDIUM RISK)**
   - Horror movies, night scenes, noir films with >80% dark pixels at sample positions get flagged `TooDark` and excluded from the entire scan.

3. **pHash single-sample is a harder gate (MEDIUM RISK)**
   - VDF's pHash mode checks only the first sample's hash. If that one sample differs (even if the rest of the video is identical), the pair is rejected.

### Risk ranking

| Rank | App | Risk |
|------|-----|------|
| 1 (highest) | VDF | Single-sample misses real duplicates with local differences |
| 2 | VDF | Dark-frame exclusion too aggressive for dark content |
| 3 | VideoCull | Duration tolerance can miss trimmed variants |

**Summary**: VDF has higher false-negative risk; VideoCull has higher false-positive risk. This confirms the user's suspicion — VideoCull casts a wider net.

---

## 5. Daisy-Chain / Grouping Risk

### VideoCull grouping

1. **Build phase** ([duplicates.js L583-L728](file:///d:/GitHub/Video-Cull/electron/duplicates.js#L583-L728)):
   - Pairs sorted by similarity (highest first).
   - For each pair: if both already in different groups, merge is allowed only if the two group representatives score ≥ threshold.
   - If one is in a group, the new video must score ≥ threshold against the representative.
   - This prevents *some* daisy-chaining, but the representative is chosen at group creation time and never updated.

2. **Pruning phase** ([duplicates.js L476-L551](file:///d:/GitHub/Video-Cull/electron/duplicates.js#L476-L551)):
   - `pruneWeakDaisyChainMembers`: for groups ≥ 3 members, iteratively removes the member with fewest connections (scored via `directSimilarity`).
   - Threshold: `connections ≥ ceil((active.length - 1) / 2)`.
   - Pruned members are recursively re-clustered via connected components.

3. **Weakness**: The pruning uses `directSimilarity` which looks up the *original* pairwise similarity from the worker output. It does NOT recompute visual similarity. If the original pair comparison was marginal (e.g., 95.1%), the pruning trusts that score. VDF's `SplitDaisyChainGroups` re-runs `CheckIfDuplicate` on every pair, which is a full recomputation.

### VDF grouping

1. **Build phase** ([ScanEngine.cs L801-L855](file:///d:/GitHub/Video-Cull/testspace/videoduplicatefinder/VDF.Core/ScanEngine.cs#L801-L855)):
   - `MergeDuplicate`: same representative-gate approach.
   - New items joining a group must match the group's representative.
   - Merging two groups requires representative-to-representative similarity check.
   - `mergesBlocked` counter tracks how often this fires.

2. **Pruning phase** ([ScanEngine.cs L1413-L1583](file:///d:/GitHub/Video-Cull/testspace/videoduplicatefinder/VDF.Core/ScanEngine.cs#L1413-L1583)):
   - `SplitDaisyChainGroups`: **re-runs `CheckIfDuplicate`** for every pair in the group to build a fresh similarity matrix.
   - Same majority-pruning algorithm: members must be similar to ≥ `ceil((count-1)/2)` others.
   - Pruned items are re-clustered via connected components, with recursive sub-group validation.
   - Sub-groups that fail validation are removed entirely.

3. **Key difference**: VDF's recomputation during pruning is more reliable because it re-evaluates similarity with current settings rather than relying on cached pair scores. VideoCull's `directSimilarity` lookup can return stale or threshold-marginal scores.

### Comparative risk

| Aspect | VideoCull | VDF |
|--------|-----------|-----|
| Representative gate | ✅ Present | ✅ Present |
| Daisy-chain pruning | ✅ Present | ✅ Present |
| Pruning recomputes similarity | ❌ Uses cached pair scores | ✅ Full `CheckIfDuplicate` recomputation |
| Recursive sub-group validation | ✅ via `splitDaisyChainIds` | ✅ via nested pruning loop |
| Singleton removal | ✅ Filtered at group output | ✅ Explicit `Duplicates.Remove` |

> [!WARNING]
> VideoCull's daisy-chain pruning is weaker because it trusts cached similarity scores rather than recomputing them. A pair that was 95.1% similar during initial comparison may have been marginal — the pruning phase assumes it's still valid without re-checking.

---

## 6. Threshold and Defaults Review

### Current VideoCull defaults

| Setting | Default | Assessment |
|---------|---------|------------|
| `comparisonMode` | `'visual'` | ⚠️ Visual mode (grayscale MAE) is more false-positive prone than pHash for the same threshold. MAE is sensitive to brightness/contrast changes but insensitive to structural changes. |
| `sampleCount` | `3` | ✅ Reasonable. More samples = better discrimination. Better than VDF's default of 1. |
| `finalSimilarityThreshold` | `95` | ⚠️ **Too loose** for visual mode. 95% MAE similarity means average pixel difference of 5/255 ≈ 12.75 intensity levels. Two different videos with similar color palettes can easily be within this range. VDF uses 96%. |
| `durationTolerancePercent` | `20` | ⚠️ **Too loose**, AND the tolerance calculation uses `Math.max` of both durations, making it even looser. See §3. |
| `requireEverySample` | `false` | ⚠️ **Should be `true`**. Without this, one matching sample can compensate for mismatches on others. |
| `ignoreBlackPixels` | `false` | ⚠️ **Risk**: black frames match each other at near-100%. Should at least warn or auto-detect. |
| `ignoreWhitePixels` | `false` | ✅ Low risk. White frames are rare in video content. |
| `compareFlipped` | `false` | ✅ Correct default. Enabling this doubles comparison time with minimal benefit. |
| `samplingWindow` | `'even'` | ✅ Good. Evenly spaced samples cover the most content. |
| `maxSamplingDuration` | `0` (disabled) | ✅ Correct. |

### Recommended safer defaults

| Setting | Current | Recommended | Rationale |
|---------|---------|-------------|-----------|
| `finalSimilarityThreshold` | 95 | **97** | Reduces false positives significantly. Users who want looser matching can lower it. |
| `requireEverySample` | `false` | **`true`** | Prevents one good sample from masking mismatches. Critical for 3-sample mode. |
| `durationTolerancePercent` | 20 | **10** | 20% is very generous. A 60s vs 48s match is rarely a true duplicate. |
| Duration tolerance base | `Math.max` | **`Math.min`** | Match VDF's approach: use the shorter video's duration as the base. This is a code change, not a setting. |
| `ignoreBlackPixels` | `false` | `false` (keep) | But add automatic detection: if a sample's `frameDarkRatio` > 0.8, flag it and reduce its weight or skip it. |
| `sampleCount` | 3 | **5** | More samples = harder to false-positive. Marginal cost increase (2 more FFmpeg calls per video). |

---

## 7. Empirical Test Plan

### Test set design

Each test class contains 10 video pairs. For each pair, run both VideoCull and VDF with default settings and record:
- Whether a duplicate group was created
- The reported similarity score
- The group composition

---

### Test Class 1: Exact duplicates (10 pairs)
**Setup**: Identical byte-for-byte copies with different filenames.

| Metric | Expected VideoCull | Expected VDF |
|--------|--------------------|--------------|
| Detection | ✅ All detected (exact pass) | ✅ All detected (visual similarity ≈ 100%) |
| False positive | None | None |
| False negative | None | None |

**FP indicator**: N/A
**FN indicator**: Any pair not grouped

---

### Test Class 2: Re-encoded duplicates (10 pairs)
**Setup**: Same source re-encoded with different codecs (H.264→H.265, CRF changes, resolution preserved).

| Metric | Expected VideoCull | Expected VDF |
|--------|--------------------|--------------|
| Detection | ✅ Most detected (similarity 92-99%) | ✅ Most detected if using multi-sample |
| False positive | None expected | None expected |
| False negative | Possible for aggressive re-encodes < 95% | Possible for re-encodes < 96% |

**FP indicator**: N/A
**FN indicator**: Real re-encode pair not grouped

---

### Test Class 3: Visually similar but different videos (10 pairs)
**Setup**: Different videos of the same subject (e.g., two different shots of the same building, two different interviews in the same room).

| Metric | Expected VideoCull | Expected VDF |
|--------|--------------------|--------------|
| Detection | ⚠️ **Some falsely grouped** | ⚠️ Fewer falsely grouped (stricter threshold) |
| False positive | **HIGH RISK** — similar color palettes + similar duration = match | Lower risk due to stricter threshold |
| False negative | N/A (these aren't duplicates) | N/A |

**FP indicator**: Any pair grouped = false positive
**FN indicator**: N/A

---

### Test Class 4: Same scene, different clips (10 pairs)
**Setup**: Different segments from the same long recording (e.g., minutes 0-5 vs minutes 10-15 of a 30-minute video).

| Metric | Expected VideoCull | Expected VDF |
|--------|--------------------|--------------|
| Detection | ⚠️ **Likely some falsely grouped** if clips have similar visual content | Less likely (single sample less likely to coincide) |
| False positive | **HIGH RISK** — same scene aesthetics + 20% duration tolerance | Medium risk |
| False negative | N/A | N/A |

**FP indicator**: Any pair grouped = false positive
**FN indicator**: N/A

---

### Test Class 5: Black/static videos (10 pairs)
**Setup**: Mix of all-black videos, mostly-black with brief content, and static frame videos (e.g., title cards).

| Metric | Expected VideoCull | Expected VDF |
|--------|--------------------|--------------|
| Detection | ⚠️ **All-black videos grouped together** | ✅ Black videos excluded by `TooDark` flag |
| False positive | **HIGH RISK** — black frames compare as near-identical | Low risk |
| False negative | N/A | Dark but valid content excluded (false negative for dark content) |

**FP indicator**: Unrelated black/static videos grouped = false positive
**FN indicator**: N/A (for VDF: valid dark duplicate pair not grouped)

---

### Test Class 6: Watermarked variants (10 pairs)
**Setup**: Same video, one with a watermark overlay (corner logo, text overlay).

| Metric | Expected VideoCull | Expected VDF |
|--------|--------------------|--------------|
| Detection | ✅ Most detected (watermarks are small relative to 32×32 downscale) | ✅ Most detected |
| False positive | None expected | None expected |
| False negative | Possible for large watermarks | Possible for large watermarks |

**FP indicator**: N/A
**FN indicator**: Real watermarked pair not grouped

---

### Test Class 7: Trimmed variants (10 pairs)
**Setup**: Same video with different intro/outro trims (5%, 10%, 15%, 20%, 25%, 30% trimmed).

| Metric | Expected VideoCull | Expected VDF |
|--------|--------------------|--------------|
| Detection | ⚠️ Detects up to 20% trim (duration tolerance) | ⚠️ Detects less (stricter tolerance via `Math.Min`) |
| False positive | Possible — different sample timestamps may hit different frames | Lower risk |
| False negative | Trims > 20% missed | Trims > ~17% missed (due to `Min` calculation) |

**FP indicator**: Trimmed video grouped with wrong match
**FN indicator**: Real trimmed duplicate not grouped

---

### Test Class 8: Different duration variants (10 pairs)
**Setup**: Pairs with increasing duration differences (5%, 10%, 15%, 20%, 25%, 30%, 40%, 50%).

| Metric | Expected VideoCull | Expected VDF |
|--------|--------------------|--------------|
| Detection | Passes up to 20% diff (relative to longer) | Passes up to ~17% diff (relative to shorter) |
| False positive | ⚠️ **Videos at 18-20% diff matched despite being different clips** | Less likely |
| False negative | > 20% diff always missed | > ~17% diff always missed |

**FP indicator**: Different-content pair within duration tolerance grouped
**FN indicator**: Same-content pair outside tolerance not grouped

---

### Test Class 9: Same-size different-content files (10 pairs)
**Setup**: Files with identical byte sizes but different video content (crafted or coincidental).

| Metric | Expected VideoCull | Expected VDF |
|--------|--------------------|--------------|
| Detection | ⚠️ Exact pass reaches quick-signature stage → SHA-256 blocks false match. Visual pass may still match if content is similar. | Visual only — depends on content similarity |
| False positive | Low risk (SHA-256 prevents exact match; visual must independently match) | Low risk |
| False negative | N/A | N/A |

**FP indicator**: Different-content same-size pair grouped
**FN indicator**: N/A

---

### Test Class 10: Corrupted/unknown-duration files (10 files)
**Setup**: Files with missing headers, truncated streams, zero-duration metadata, no video stream.

| Metric | Expected VideoCull | Expected VDF |
|--------|--------------------|--------------|
| Detection | ⚠️ Zero-duration files bypass duration filter, compared against each other | ✅ Invalid entries excluded (`InvalidEntryForDuplicateCheck`) |
| False positive | **MEDIUM RISK** — corrupted files with similar garbage frames can match | Low risk |
| False negative | N/A | Corrupted files never scanned |

**FP indicator**: Corrupted files grouped together or with valid files
**FN indicator**: N/A

---

## 8. Concrete Improvements for VideoCull

### Priority 1: Critical (directly reduce false positives)

#### 1a. Fix duration tolerance calculation
**File**: [duplicate-utils.js L223-L230](file:///d:/GitHub/Video-Cull/electron/duplicate-utils.js#L223-L230)

Change `durationsWithinTolerance` to use `Math.min` of both durations as the base, matching VDF's approach:

```diff
- const percentAllowance = Math.max(durationA, durationB) * ((settings.durationTolerancePercent ?? 2) / 100);
+ const percentAllowance = Math.min(durationA, durationB) * ((settings.durationTolerancePercent ?? 2) / 100);
```

**Impact**: Immediately tightens the duration gate. A 60s vs 48s pair goes from "within tolerance" to "outside tolerance".

#### 1b. Change default `requireEverySample` to `true`
**File**: [duplicate-utils.js L18](file:///d:/GitHub/Video-Cull/electron/duplicate-utils.js#L18)

```diff
- requireEverySample: false,
+ requireEverySample: true,
```

**Impact**: Every sample must independently meet the threshold. Prevents one matching frame from carrying two mismatches.

#### 1c. Raise default threshold to 97%
**File**: [duplicate-utils.js L16](file:///d:/GitHub/Video-Cull/electron/duplicate-utils.js#L16)

```diff
- finalSimilarityThreshold: 95,
+ finalSimilarityThreshold: 97,
```

**Impact**: Significant reduction in borderline false positives. Real duplicates (re-encodes) typically score 97%+.

#### 1d. Lower default duration tolerance to 10%
**File**: [duplicate-utils.js L17](file:///d:/GitHub/Video-Cull/electron/duplicate-utils.js#L17)

```diff
- durationTolerancePercent: 20,
+ durationTolerancePercent: 10,
```

**Impact**: Combined with the `Math.min` fix, this creates a much tighter duration gate.

---

### Priority 2: Important (structural improvements)

#### 2a. Add dark-frame detection and weighting
Add logic to detect and handle samples where `frameDarkRatio > 0.8`:
- If ALL samples for a video are dark (ratio > 0.8), skip the video from visual comparison entirely (match VDF's `TooDark` behavior).
- If SOME samples are dark, exclude those samples from the average and require the remaining samples to meet threshold.
- Note: `frameDarkRatio` is already computed in [duplicate-utils.js L208-L215](file:///d:/GitHub/Video-Cull/electron/duplicate-utils.js#L208-L215) and stored in fingerprints. It's just never used during comparison.

#### 2b. Recompute similarity during daisy-chain pruning
In `pruneWeakDaisyChainMembers` ([duplicates.js L476-L508](file:///d:/GitHub/Video-Cull/electron/duplicates.js#L476-L508)), the `connectionScore` function looks up cached similarity. Consider loading the gray frames and recomputing similarity for groups flagged for pruning, matching VDF's `SplitDaisyChainGroups` approach.

#### 2c. Add confidence labels to groups
In `buildGroups` ([duplicates.js L583-L728](file:///d:/GitHub/Video-Cull/electron/duplicates.js#L583-L728)), compute a confidence tier based on:
- **High confidence**: All sample pairs > 99%, duration diff < 1%
- **Medium confidence**: Average > threshold, some samples between 95-99%
- **Low confidence**: Average barely above threshold, or duration diff > 10%

Display this in the UI alongside the similarity percentage to help users prioritize review.

#### 2d. Separate exact and visual groups in UI
Currently [DuplicateGroupsView.tsx](file:///d:/GitHub/Video-Cull/src/components/DuplicateGroupsView.tsx) shows both exact and visual groups in the same list. Consider:
- Visual separation (different header colors / icons)
- Exact groups should be auto-selectable for deletion with higher confidence
- Visual groups should require more user attention
- The `matchType` field already supports this (`'exact'`, `'visual'`, `'phash'`, `'mixed'`)

---

### Priority 3: Nice-to-have (additional safety)

#### 3a. Increase default sample count to 5
```diff
- sampleCount: 3,
+ sampleCount: 5,
```

More samples = exponentially harder to false-positive, at a linear cost increase.

#### 3b. Add per-sample similarity display
Show individual sample scores in the UI so users can see which samples matched and which were weak. This is diagnostic — helps users understand borderline groups.

#### 3c. Add a "strict mode" preset
Create a one-click preset that sets:
- `finalSimilarityThreshold: 99`
- `requireEverySample: true`
- `durationTolerancePercent: 5`
- `sampleCount: 5`

For users who want to minimize false positives at the cost of missing some real duplicates.

#### 3d. Benchmark test suite
Create automated tests using crafted video pairs from the test plan above. Run both apps against the same set and compare results programmatically. This makes false-positive regressions catchable in CI.

#### 3e. UI wording changes
- Change "Duplicates" header to "Potential Duplicates" for visual/pHash groups
- Change "Mark selected" to "Mark selected for deletion"
- Add a tooltip on similarity percentage explaining what it means
- For groups where `matchType !== 'exact'`, add a subtle "Review recommended" indicator

---

## Summary

| Question | Answer |
|----------|--------|
| Does VideoCull likely produce more false positives than VDF? | **Yes** |
| Does VDF likely produce fewer false positives than VideoCull? | **Yes** |
| Is VDF more likely to miss real duplicates (false negatives)? | **Yes**, due to single-sample default and dark-frame exclusion |
| Which algorithm is more conservative? | **VDF** — stricter threshold, stricter duration tolerance, dark-frame exclusion |
| Which is more likely to group visually similar but non-identical videos? | **VideoCull** — looser threshold, average-based scoring, no dark-frame filter |
| Which is more likely to create daisy-chain groups? | **VideoCull** — cached similarity scores in pruning phase (though both have similar mitigation) |

> [!TIP]
> The four changes in **Priority 1** (fix duration tolerance base, enable `requireEverySample`, raise threshold to 97%, lower duration tolerance to 10%) would together bring VideoCull's false-positive rate close to or below VDF's while retaining VideoCull's advantage in sample count and exact-duplicate detection.
