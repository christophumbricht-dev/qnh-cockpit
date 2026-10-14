import { defineConfig, loadEnv } from "vite";

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
    `img-src 'self' data: blob: https://flydownwind.ch ${supabase.join(" ")}`,
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
  plugins: [csp(loadEnv(mode, process.cwd(), "VITE_"))],
}));
