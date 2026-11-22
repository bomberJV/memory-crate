# Memory Crate

A visual memory-packing workshop by Brandon Frank Han-Chween Huang. Build a hypothetical model loadout, solve four packing briefs, and see the separate cost of weights, a conventional key/value cache, and a manual reserve.

Plain HTML, CSS and browser JavaScript. No build step, remote services, vendor model presets, or runtime dependencies.

## Run

Serve the project collection's root over HTTP:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/memory/`. ES modules require HTTP; do not open `index.html` directly from the filesystem. The shared stylesheet and browser helpers live in `../shared/`.

## What you can do

- **Free workshop:** change parameters, weight bits, cached tokens, simultaneous sequences, capacity and reserve.
- **Inside an Inference — accounting trace:** keep a baseline visible while changing the same workshop inputs. Inspect before/after allocations, their dependencies and what stayed fixed. All trace values use the existing pure accounting model.
- **Context growth:** inspect 0, 2,048, 8,192, 16,384 and 32,768 cached tokens per sequence with all other inputs held fixed. Context can exceed the estimated budget; the required allocation and excess remain visible.
- **Calculation receipt:** inspect the current weight and cache calculation in bytes, decimal GB and binary GiB, alongside the separately assumed reserve and budget.
- **Four packing briefs:** satisfy the model/cache requirements using the highest feasible weight precision. The capacity and reserve are fixed by each brief. Brief completion is checked against the full requirements; reducing the requested model or cache does not earn credit.
- **Fractional allocation grid:** 64 cells show exact segment fractions for weights, cache, reserve and remaining capacity. Overflow is counted separately in a visible spill area rather than squeezing it into the grid.
- **Precision comparison:** four selectable cards hold everything constant except bits per weight.
- **Pinned builds:** keep two distinct configurations side by side and load either back into the workshop.
- **Local persistence:** solved briefs, valid comparisons and the last free-play build stay in this browser. No data leaves the device.

Controls use ordinary buttons and selects, with native Tab and Enter/Space behavior. The grid is decorative and has an accessible textual allocation summary. Values, live feedback and requirement checkmarks do not rely on color alone. Motion is minimal and includes a reduced-motion preference rule. Browser and assistive-technology verification is recorded separately below.

## Accounting

The weight estimate uses decimal billions of parameters and binary GiB:

`weight GiB = parameters in billions × 10^9 × bits per weight / 8 / 2^30`

The cache estimate uses two tensors (keys and values) for every layer:

`cache GiB = 2 × layers × KV heads × head dimension × cached tokens × sequences × bytes per value / 2^30`

The fixed teaching architecture has **32 layers, 8 KV heads, a head dimension of 128 and 16-bit cache values**. It uses exactly 1 GiB for 8,192 cached tokens in one sequence. Each additional sequence has its own cache, but shares the weights. Changing weight precision does not change cache precision.

GB and GiB are different units: **1 GB = 1,000,000,000 bytes; 1 GiB = 1,073,741,824 bytes**. Budgets, allocation totals, free space and overflow use GiB throughout. An 8B model at 16 bits has 16,000,000,000 ideal weight bytes = 16 GB = approximately 14.901161 GiB. At 4 bits, it has 4,000,000,000 bytes = 4 GB = approximately 3.725290 GiB. These figures exclude quantization metadata.

The parameter count and cache architecture are independent controls. They do not represent any named 3B, 8B, 13B, 30B or 70B model. A manual reserve is added to the calculation; it is not inferred or measured runtime overhead.

The cache tensor-shape reference is documented at:
https://huggingface.co/docs/transformers/en/cache_explanation

## Inside an Inference: first milestone

The delivered scope is **memory accounting and dependencies**. No model weights or tokenizer are downloaded, no prompt is executed, and no runtime memory or latency is measured.

The guided fixture starts with 8B parameters at 16-bit weight precision, a 16-GiB budget, zero cached tokens, one sequence and a 1-GiB assumed reserve. It initially needs approximately 15.901 GiB. Adding 8,192 cached tokens adds exactly 1 GiB of cache, bringing the total to approximately 16.901 GiB and exceeding the budget by approximately 0.901 GiB. Shared weights and assumed reserve remain fixed.

The before/after trace distinguishes an affected dependency from an actual numeric change. For example, changing sequence count affects the cache calculation, but the cache remains zero when context is zero. Changing only the budget leaves all three allocations unchanged. The trace, context series and allocation display call the same accounting functions as the workshop; their visuals do not introduce a second set of formulas.

Boundary behavior is deterministic:

- Zero cached tokens produce zero cache while retaining weights and reserve.
- An exact total equal to capacity is within the estimated budget, with zero free space and zero overflow.
- Any representable total above capacity exceeds the budget, including a one-byte excess. Display rounding never determines whether a build fits.
- Arithmetic helpers reject negative, missing, non-numeric and non-finite required inputs, and reject calculations that overflow to a non-finite result. Stored workshop values still use the existing allowlist and restore supported defaults when malformed.
- Reset actions restore their declared starting configuration or comparison baseline; they do not derive a replacement configuration by trying to make the total fit.

The trace baseline lasts for the current page session:

| Control | Result |
| --- | --- |
| Load context example | Enters free play and resets both the current build and baseline to `TRACE_BUILD`: 8B, 16-bit weights, 16-GiB budget, zero tokens, one sequence, 1-GiB reserve. |
| Keep current as baseline | Copies the current build into the comparison baseline. Subsequent changes do not mutate that copy. |
| Reset to baseline | Enters free play and restores a copy of the baseline as the current build. |
| Reset build, in the workshop | Keeps its existing behavior: resets free play to `DEFAULT_BUILD`, or restarts the selected packing brief. The trace baseline stays unchanged. |

**The next project asks a different question.** The [medical AI research](https://github.com/bomberJV/medical-ai-research) concerns a different experiment, with its own models, data and protocol. Fitting this hypothetical memory budget is not evidence of reliability or accuracy, and changing this example's precision does not alter any medical result.

### Later execution milestone — not implemented

I-04–I-06 require a separately selected licensed small model and tokenizer, pinned revisions and inputs, actual execution, prefill/decode traces and repeated raw measurements with a run manifest. A recorded fallback must be clearly labeled. Browser heap must never be presented as GPU memory, and unsupported measurements must say that they were not measured. No accuracy effect can be inferred from lower precision without evaluating that same configuration under a separate controlled protocol.

## Limits

This is an arithmetic planning tool and educational puzzle, not an inference benchmark. A within-budget estimate does not guarantee a model can run. It omits quantization metadata, activations, intermediates, allocator behavior, device memory already in use, architecture-specific cache schemes and runtime layout. Offloading and distributed inference are not modeled.

The game rewards the highest feasible bit depth only to make the puzzle objective unambiguous. Higher precision is not a universal recommendation, nor a promise of better model output. Real quality/performance tradeoffs need measurement.

The reserve includes neither a calculated safety margin nor a measured runtime guarantee. The colored cells are a visual partition of capacity, not a depiction of physical memory allocation or actual addresses.

## Files

- `index.html`: page structure and accessible controls.
- `app.css`: tactile crate, allocation legend, challenges and responsive layout.
- `app.js`: UI state, persistence, challenge feedback and comparisons.
- `trace.js`: accessible allocation trace, context series and calculation receipt using the shared model.
- `model.js`: pure byte/unit accounting, validation, dependency traces, context fixtures, allocation segmentation and challenge rules.
- `../shared/`: shared page styling and safe localStorage helpers.

## Tests

The root `tests/memory.test.mjs` checks:

- Decimal parameter counts versus binary storage units.
- Exact decimal/binary fixtures: 8B at 16 bits is 16 GB; the declared 8,192-token cache is exactly 1 GiB.
- Cache geometry and independent precision/sequence scaling.
- Before/after dependency traces, immutable baseline inputs and context growth across the budget.
- Weight/cache/reserve accounting and overflow.
- Zero context, exact capacity, one-byte overflow, arithmetic overflow and fixture reset.
- Solvability and optimal precision for all four briefs.
- Rejection of smaller-than-required loads and changed budgets.
- Fractional cell accounting, including oversized loads.
- Corrupt settings/progress and unsupported stored values.
- Explicit rejection of invalid numerical inputs.
- Fair four-way precision comparisons.

Run from the collection root:

```sh
node --test tests/memory.test.mjs
```

The first milestone targets I-01 (unit accounting), I-02 (dependencies), I-03 (boundaries and reset) and I-07 (a separate medical experiment). Reproduce the guided fixture above, double the sequence count and change weight precision independently, then inspect the unchanged rows and reset state. Also inspect the handoff text and use the controls by keyboard.

The PR records the actual test commands, browser checks and any remaining coverage limits. Automated tests cover pure rules and calculations; they do not claim comprehensive device or assistive-technology certification. I-04–I-06 are outside this milestone and are not marked passed.

### Verification and remaining acceptance

The implementation run passed all **22 local Node tests** (`node --test tests/*.test.mjs`). These verify the model portions of I-01 and I-02, and I-03 arithmetic boundaries, invalid inputs and fixture restoration. They do not exercise browser event handlers.

Browser review remains pending: the browser could not reach the local HTTP preview, and its URL policy rejected the local-file fallback. No screenshots, viewport checks, keyboard walkthrough or rendered reset verification were obtained. The I-07 handoff is present in semantic page text and documentation, but its rendered presentation still needs browser review. The first milestone is therefore not recorded as fully accepted. Actual execution and measurements under I-04–I-06 remain unimplemented.

