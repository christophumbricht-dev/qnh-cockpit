// App Store Connect + Codemagic status via the QNH Core edge function store-status (read-only).
// The API keys live only as secrets of that function, never in the cockpit.
import { DEMO, client } from "../api.js";
import { QNH } from "../apps.js";
import { demoStatus } from "./demo.js";

export async function loadStoreStatus(bundleIds) {
  if (DEMO) return demoStatus(bundleIds);
  const { data, error } = await client(QNH).functions.invoke("store-status", { body: { bundle_ids: bundleIds } });
  if (error) {
    // FunctionsHttpError: the function's JSON is in error.context
    const body = await error.context?.json?.().catch(() => null);
    if (error.context?.status === 404) throw new Error("Die Funktion store-status ist noch nicht installiert (Anleitung: docs/store-setup.md).");
    throw new Error(body?.error ?? error.message);
  }
  return data;
}
