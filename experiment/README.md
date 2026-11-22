# Before the first word

This chapter replays CPU inference on a fixed public model. The landing view aligns two separately timed requests at the start of prefill. The full-board correction replaces a single digit in the prompt and selects a third independently recorded condition. It never edits generated text in presentation code.

## Reproduce the capture

Use Linux x86-64 and Python 3.11. Install `python -m pip install -r experiment/requirements.txt`, then run `python experiment/record.py recorded-run.json`. The capture downloads the model and tokenizer at commit `12fd25f77366fa6b3b4b768ec3050bf629380bac`. Both come from HuggingFaceTB/SmolLM2-135M-Instruct under Apache 2.0. SHA-256 hashes for the files actually loaded are in the record. The homepage downloads only the recorded data. [Model and tokenizer](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/tree/12fd25f77366fa6b3b4b768ec3050bf629380bac)

## What the clocks cover

Each timed interval covers a synchronous CPU forward pass and greedy argmax through retrieval of the token ID. The first interval consumes the full tokenized chat prompt (prefill). Subsequent intervals each process the previous emitted token using a dynamic KV cache (decode). The 12-token cutoff is fixed across conditions and is shown as an excerpt. Input IDs include the tokenizer's chat template. Tokenizing, loading, printing, request admission and inspecting memory are outside these intervals.

The raw file contains initialization time after model download, the first generation call on the short condition, one discarded warmup per condition, and five retained warm repetitions per condition in rotating order. The first generation call is recorded separately. The retained timestamps are integer nanoseconds. Playback accumulates timed intervals in each selected run. The selected run is the actual repetition at median prefill time. The displayed decode statistic pools measured decode steps within each condition. Raw samples support independent calculations of spread. Replay uses exact stored token IDs and event boundaries. Across machines elapsed times can vary. Within the published repeats all greedy IDs were checked for equality.

Measured KV payload sums live key/value tensor elements multiplied by their actual element sizes. The independent estimate uses the checked-in model dimensions and FP32 cache precision. Process RSS is sampled after each forward pass and is a process-wide snapshot. It includes Python and runtime allocations. Parameter payload sums unique model parameters. Peak RSS, device memory, power and answer quality were not measured. This 135M experiment is distinct from the hypothetical 8B teaching fixture.

[Recording workflow](https://github.com/bomberJV/memory-crate/actions/runs/45038204630) · [Raw recordings](recorded-run.json)
