# Examples

- [`basic-print/`](basic-print) — the smallest standalone Node.js project using the public [`@portixone/sdk`](https://www.npmjs.com/package/@portixone/sdk) npm package (not a monorepo reference). Runs in mock mode out of the box — `npm install && npm start`, no runtime, no printer.
- [`quickstart-html/`](quickstart-html) — minimal HTML page that uses `@portixone/sdk` to print a test ticket against the local runtime. Serves the "Time to First Print" goal directly.

`quickstart-html` requires `npm run build` (in the `sdk-js` workspace) before opening `index.html`, and the runtime running (`npm run dev`). `basic-print` needs neither — it installs the real published package.
