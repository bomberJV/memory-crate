# Memory Crate

[![Tests](https://github.com/bomberJV/memory-crate/actions/workflows/tests.yml/badge.svg)](https://github.com/bomberJV/memory-crate/actions/workflows/tests.yml) · [Open it on brandonfhuang.com](https://brandonfhuang.com/projects/play/memory/)

Compare the same model reading one configuration setting and its whole configuration file. Each trace shows when the first token appeared and how much KV cache the input occupied. [Capture protocol and raw repetitions](experiment/README.md)

Inspect the token that pushes a third request over a 24 GiB memory budget. Move its arrival, change weight precision, or shorten its context. The chart and the original packing workshop use the same calculator for shared weights, private KV caches and an assumed reserve.

From the repository root, run `python -m http.server 8000` and open [Memory Crate](http://localhost:8000/memory/).

Run `node --test tests/*.test.mjs` with Node 22 or newer.

[Controls, source notes and limitations](memory/README.md) · [Portfolio](https://brandonfhuang.com)

The standalone app uses browser-local storage where applicable. The portfolio supplies Google sign-in and account-backed saves.

## License

Created by Brandon Frank Han-Chween Huang ([brandonfhuang.com](https://brandonfhuang.com)).

- **Code** (scripts, styles, page markup, tests and tools): [Apache License 2.0](LICENSE). Keep the [NOTICE](NOTICE) file with any copy or derivative.
- **Writing, figures, papers, results and narration recordings**: [CC BY 4.0](LICENSE-CC-BY-4.0.txt). Credit “Brandon Frank Han-Chween Huang” and link to https://brandonfhuang.com or this repository.
- **Third-party files** keep their own licenses:
  - `shared/symbols.woff` is a DejaVu font subset under the Bitstream Vera license ([shared/FONT-LICENSE.txt](shared/FONT-LICENSE.txt)).

