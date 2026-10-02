# Credits

**open-quill** is built on the shoulders of excellent open-source software. Thank you to the maintainers of every project below.

Licenses listed for bundled dependencies were read from the installed packages and the lockfiles. Run `npm ls` in the repo root, `server/` or `client/` for the exact resolved tree, and check each package's own LICENSE file for the authoritative terms.

## Runtime
- [Node.js](https://nodejs.org) - MIT

## Server
- [Express](https://expressjs.com) - MIT - HTTP server and routing
- [ws](https://github.com/websockets/ws) - MIT - WebSocket streaming
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) - MIT - session tokens
- [argon2](https://github.com/ranisalt/node-argon2) - MIT - argon2id password hashing
- [multer](https://github.com/expressjs/multer) - MIT - file uploads, built on [busboy](https://github.com/mscdex/busboy) (MIT)
- [cookie](https://github.com/jshttp/cookie) - MIT - cookie parsing
- [Anthropic SDK for TypeScript](https://github.com/anthropics/anthropic-sdk-typescript) (`@anthropic-ai/sdk`) - MIT - the Anthropic Messages API connection type

## Database
- [better-sqlite3-multiple-ciphers](https://github.com/m4heshd/better-sqlite3-multiple-ciphers) - MIT - encrypted SQLite storage (AES-256 / SQLCipher)
- [SQLite3 Multiple Ciphers](https://github.com/utelle/SQLite3MultipleCiphers) - MIT - the encryption layer the above is built on
- [SQLite](https://www.sqlite.org) - public domain - the underlying database engine

## Documents
- [pdfjs-dist](https://github.com/mozilla/pdf.js) - Apache-2.0 - PDF text extraction for the memory bank and project files
- [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) - MIT - the canvas implementation pdf.js loads on Node

  pdf.js also ships the CMap tables and standard font data that open-quill loads from disk, so PDFs using predefined CJK encodings or non-embedded fonts extract correctly without any network access. The standard fonts are the Foxit fonts from [PDFium](https://pdfium.googlesource.com/pdfium/) (BSD-style license) and [Liberation Sans](https://github.com/liberationfonts/liberation-fonts) from Red Hat (GPL v2 with the Liberation font exception); each upstream license file ships inside `pdfjs-dist/standard_fonts`.

## Client
- [React](https://react.dev) and [React DOM](https://react.dev) - MIT
- [react-markdown](https://github.com/remarkjs/react-markdown) - MIT - markdown rendering
- [remark-gfm](https://github.com/remarkjs/remark-gfm) - MIT - GitHub-flavored markdown
- [remark-math](https://github.com/remarkjs/remark-math) - MIT - math parsing in markdown
- [rehype-katex](https://github.com/remarkjs/remark-math/tree/main/packages/rehype-katex) - MIT - renders parsed math with KaTeX
- [KaTeX](https://katex.org) - MIT - math typesetting, fonts included
- [highlight.js](https://highlightjs.org) - BSD-3-Clause - syntax highlighting

## Build tooling
- [Vite](https://vite.dev) - MIT - build tooling and dev server
- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) - MIT - React support for Vite
- [Rolldown](https://rolldown.rs) - MIT - the bundler inside Vite
- [Lightning CSS](https://lightningcss.dev) - MPL-2.0 - CSS transforms and minification in the Vite build. A development-only tool, nothing from it is shipped in the bundle
- [PostCSS](https://postcss.org) - MIT - CSS processing in the Vite build
- [concurrently](https://github.com/open-cli-tools/concurrently) - MIT - runs the client and server together in development

## Linting
- [ESLint](https://eslint.org) and [@eslint/js](https://github.com/eslint/eslint/tree/main/packages/js) - MIT - the linter and its recommended rules
- [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) - MIT - React rules
- [eslint-plugin-react-hooks](https://github.com/facebook/react/tree/main/packages/eslint-plugin-react-hooks) - MIT - hooks rules
- [globals](https://github.com/sindresorhus/globals) - MIT - global variable definitions

## Transitive dependencies
The direct dependencies above pull in a wider tree: 125 packages under `server/` (all shipped at runtime), 172 under `client/` (131 of them reach the bundle or the server-side render, 41 are build-only) and 260 in the root, all of them lint and development tooling. Most of the client total is the [unified](https://unifiedjs.com) collective - remark, rehype, mdast, hast, micromark and friends - which powers markdown parsing. Most of the server total is Express and its [jshttp](https://github.com/jshttp) and [pillarjs](https://github.com/pillarjs) modules. Every one of those maintainers deserves the same thanks as the names listed above.

Across the three trees the licenses are overwhelmingly MIT, with ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, Unlicense, MPL-2.0 (Lightning CSS, build-only) and CC-BY-4.0 ([caniuse-lite](https://github.com/browserslist/caniuse-lite), a lint-time data package) making up the rest.

## Fonts
All four families are vendored into `client/public/fonts` as woff2, so no font is ever fetched from a third party at runtime.

- [Literata](https://github.com/googlefonts/literata) - SIL Open Font License 1.1 - TypeTogether - the default serif, and the closest open match to the serif Claude ships
- [Newsreader](https://github.com/productiontype/Newsreader) - SIL Open Font License 1.1 - Production Type
- [Source Serif 4](https://github.com/adobe-fonts/source-serif) - SIL Open Font License 1.1 - Adobe
- [Open Sans](https://github.com/googlefonts/opensans) - SIL Open Font License 1.1 - Steve Matteson and the Open Sans Project Authors

Source Serif 4 and Open Sans are the builds packaged by [Fontsource](https://fontsource.org). Literata and Newsreader are built from the Google Fonts variable fonts and are **Modified Versions** under the OFL, which the license permits and which both families allow without a rename, carrying no Reserved Font Name.

Literata, two changes:

- the `opsz` axis is instanced out at 16, leaving `wght` 200-900, so optical sizing cannot drift with font size and the metrics stay fixed
- `OS/2.sxHeight` and `sCapHeight` are corrected to that instance's real outline values, which the instancer leaves pointing at the `opsz` default

Newsreader, three changes:

- the `opsz` axis is instanced out at 72, leaving `wght` 200-800, for the same reason
- `OS/2.sxHeight` and `sCapHeight` are corrected the same way
- the em and en dashes are redrawn at the family's own hyphen thickness; Newsreader otherwise draws them as hairlines around half that weight

Both are then subset to the Fontsource latin unicode range. `client/src/styles/fonts.css` applies ascent/descent overrides on top (and `size-adjust` for Newsreader), so both serifs sit on the same baseline at the same normal line height and swapping between them shifts no layout. Rebuilding either font means redoing that pipeline - a stock Google Fonts download will not match.

Copyright notices, as carried in the font files themselves:

- Copyright 2017 The Literata Project Authors (https://github.com/googlefonts/literata)
- Copyright 2020 The Newsreader Project Authors (http://github.com/productiontype/Newsreader)
- © 2014 - 2021 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name "Source"
- Copyright 2020 The Open Sans Project Authors (https://github.com/googlefonts/opensans)

All four are licensed under the [SIL Open Font License 1.1](http://scripts.sil.org/OFL); the full text ships with each upstream project linked above.

## Icons and logos
The provider and model logos in `client/public/assets` (the model picker, provider presets and admin lists) are SVG marks of the projects and companies they represent, in the form distributed by [LobeHub Icons](https://github.com/lobehub/lobe-icons) (MIT). Each mark is the trademark of its owner and is used only to identify that provider or model family, not to imply affiliation or endorsement. The llama.cpp mark is from the [llama.cpp](https://github.com/ggml-org/llama.cpp) project.

The open-quill mark is the project's own: the animated weave in the app, and the favicons, install icons, link preview image and `press-kit/` derived from it.

## Inference engines and local services
open-quill does not bundle these, but it is built to talk to them and would not be much use without them. Licenses are deliberately omitted here: check each project directly, since several differ from the bundled dependencies above.

- [llama.cpp](https://github.com/ggml-org/llama.cpp) - the primary target. open-quill uses its `/props`, `/slots`, `/tokenize` and `/apply-template` endpoints for context detection and exact token counts, `timings_per_token` for live generation speed, and `return_progress` for prompt processing progress
- [Ollama](https://ollama.com)
- [LM Studio](https://lmstudio.ai)
- [vLLM](https://github.com/vllm-project/vllm)
- [SearXNG](https://github.com/searxng/searxng) - the web search backend
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) and [Speaches](https://github.com/speaches-ai/speaches) - local speech-to-text over an OpenAI-compatible endpoint
- [Piper](https://github.com/rhasspy/piper), [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) and [openedai-speech](https://github.com/matatonic/openedai-speech) - local text-to-speech over an OpenAI-compatible endpoint
- [Model Context Protocol](https://modelcontextprotocol.io) - the tool integration standard behind MCP server support

Cloud providers ship as optional presets (Anthropic, OpenAI, OpenRouter, Mistral, Moonshot, Meta), but nothing contacts them unless an admin configures a provider.

## Acknowledgements
open-quill ships two interface presets that take visual cues from Anthropic's Claude web client and OpenAI's ChatGPT web client. It is an independent project, not affiliated with, endorsed by, or sponsored by either company. All product names, logos and trademarks are the property of their respective owners.