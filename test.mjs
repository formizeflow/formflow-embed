// Smoke test: the script must load without a DOM scan and expose the declared version.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
const src = readFileSync(new URL("./embed.js", import.meta.url), "utf8");
const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
assert.ok(src.includes(`v${version}`), `embed.js header should mention v${version}`);
const script = { getAttribute: (n) => (n === "data-auto-init" ? "false" : null), dataset: { autoInit: "false" }, src: "https://forms.example.com/embed.js" };
const document = { currentScript: script, readyState: "complete", querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} } };
const window = { document, addEventListener() {}, removeEventListener() {}, location: { href: "https://app.example.com/", origin: "https://app.example.com", search: "" }, navigator: {} };
window.window = window;
vm.runInNewContext(src, { window, document, self: window, globalThis: window, navigator: window.navigator, location: window.location, console });
assert.equal(window.FormFlow?.version, version);
console.log("embed.js", window.FormFlow.version, "ok");
