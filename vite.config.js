import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

// pdf.js 6 decodes scanned PDFs (CCITT G4 fax, JBIG2, JPEG 2000) and ICC colours with WebAssembly, plus a
// plain-JS fallback. They are served under <base>pdfjs-wasm/ with fixed names – in dev straight from
// node_modules, in the build copied into dist – and src/finance/reader.js passes that folder as `wasmUrl`.
// The CSP below needs no 'wasm-unsafe-eval': the decoding runs in the pdf.js worker (the meta tag does not
// apply there), and where a browser does apply it, pdf.js falls back to the plain-JS decoder (no eval).
const WASM_DIR = fileURLToPath(new URL("./node_modules/pdfjs-dist/wasm/", import.meta.url));
const WASM_FILES = ["jbig2.wasm", "jbig2_nowasm_fallback.js", "openjpeg.wasm", "openjpeg_nowasm_fallback.js", "qcms_bg.wasm",
  "LICENSE_JBIG2", "LICENSE_OPENJPEG", "LICENSE_QCMS", "LICENSE_PDFJS_JBIG2", "LICENSE_PDFJS_OPENJPEG", "LICENSE_PDFJS_QCMS"];
const WASM_TYPES = { wasm: "application/wasm", js: "text/javascript; charset=utf-8" };
function pdfjsWasm() {
  return {
    name: "qnh-pdfjs-wasm",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? "").split("?")[0].match(/\/pdfjs-wasm\/([^/]+)$/)?.[1];
        if (!name) return next();
        if (!WASM_FILES.includes(name)) { res.statusCode = 404; return res.end(); }
        res.setHeader("Content-Type", WASM_TYPES[name.split(".").pop()] ?? "text/plain; charset=utf-8");
        res.end(readFileSync(WASM_DIR + name));
      });
    },
    generateBundle() {
      for (const name of WASM_FILES) this.emitFile({ type: "asset", fileName: `pdfjs-wasm/${name}`, source: readFileSync(WASM_DIR + name) });
    },
  };
}

// Production builds get a strict Content Security Policy as a meta tag:
// scripts only from this site, network only to our own Supabase projects.
// (Not in dev: Vite's dev server needs inline scripts and a websocket.)
function csp(env) {
  const supabase = Object.entries(env)
    .filter(([k, v]) => /^VITE_.*_SUPABASE_URL$/.test(k) && v)
    .map(([, v]) => new URL(v).origin);
  const ws = supabase.map((o) => o.replace(/^https:/, "wss:"));
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // Instagram pictures of watched posts in Social → «Bei anderen» (Meta's CDN)
    `img-src 'self' data: blob: https://flydownwind.ch https://*.cdninstagram.com https://*.fbcdn.net ${supabase.join(" ")}`,
    `media-src 'self' blob: ${supabase.join(" ")}`,
    `connect-src 'self' ${[...supabase, ...ws].join(" ")}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  return {
    name: "qnh-csp",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" }],
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [pdfjsWasm(), csp(loadEnv(mode, process.cwd(), "VITE_"))],
}));
