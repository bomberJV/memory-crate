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
- **Four packing briefs:** satisfy the model/cache requirements using the highest feasible weight precision. The capacity and reserve are fixed by each brief. Brief completion is checked against the full requirements; reducing the requested model or cache does not earn credit.
- **Fractional allocation grid:** 64 cells show exact segment fractions for weights, cache, reserve and remaining capacity. Overflow is counted separately in a visible spill area rather than squeezing it into the grid.
- **Precision comparison:** four selectable cards hold everything constant except bits per weight.
- **Pinned builds:** keep two distinct configurations side by side and load either back into the workshop.
- **Local persistence:** solved briefs, valid comparisons and the last free-play build stay in this browser. No data leaves the device.

All interactions work with ordinary buttons, selects, Tab and Enter/Space. The grid is decorative and has an accessible textual allocation summary. Values, live feedback and requirement checkmarks do not rely on color alone. Motion is minimal and respects the reduced-motion preference.

## Accounting

The weight estimate uses decimal billions of parameters and binary GiB:

`weight GiB = parameters in billions × 10^9 × bits per weight / 8 / 2^30`

The cache estimate uses two tensors (keys and values) for every layer:

`cache GiB = 2 × layers × KV heads × head dimension × cached tokens × sequences × bytes per value / 2^30`

The fixed teaching architecture has **32 layers, 8 KV heads, a head dimension of 128 and 16-bit cache values**. It uses exactly 1 GiB for 8,192 cached tokens in one sequence. Each additional sequence has its own cache, but shares the weights. Changing weight precision does not change cache precision.

The parameter count and cache architecture are independent controls. They do not represent any named 3B, 8B, 13B, 30B or 70B model. A manual reserve is added to the calculation; it is not inferred or measured runtime overhead.

The cache tensor-shape reference is documented at:
https://huggingface.co/docs/transformers/en/cache_explanation

## Limits

This is an arithmetic planning tool and educational puzzle, not an inference benchmark. A within-budget estimate does not guarantee a model can run. It omits quantization metadata, activations, intermediates, allocator behavior, device memory already in use, architecture-specific cache schemes and runtime layout. Offloading and distributed inference are not modeled.

The game rewards the highest feasible bit depth only to make the puzzle objective unambiguous. Higher precision is not a universal recommendation, nor a promise of better model output. Real quality/performance tradeoffs need measurement.

The reserve includes neither a calculated safety margin nor a measured runtime guarantee. The colored cells are a visual partition of capacity, not a depiction of physical memory allocation or actual addresses.

## Files

- `index.html`: page structure and accessible controls.
- `app.css`: tactile crate, allocation legend, challenges and responsive layout.
- `app.js`: UI state, persistence, challenge feedback and comparisons.
- `model.js`: pure unit accounting, validation, allocation segmentation and challenge rules.
- `../shared/`: shared page styling and safe localStorage helpers.

## Tests

The root `tests/memory.test.mjs` checks:

- Decimal parameter counts versus binary storage units.
- Cache geometry and independent precision/sequence scaling.
- Weight/cache/reserve accounting and overflow.
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

The parent site's coordinating reviewer performs browser checks. Automated tests cover the pure rules and calculations; they do not claim comprehensive device or assistive-technology certification.
