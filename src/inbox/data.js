// «An Claude»: Christoph's instructions to Claude, general or per project (migration 20261028210000_claude_inbox.sql).
// The background run on the gaming PC does the open ones first and writes its answer into `reply`.
import { DEMO, client } from "../api.js";
import { QNH } from "../apps.js";

const sb = () => client(QNH);
const must = (r) => { if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code }); return r.data; };

// the projects of QNH GmbH (C:\QNH\CLAUDE.md); the key goes into the database, the name is shown
export const PROJECTS = [
  ["general", "Allgemein"], ["leesidelab", "Leeside Lab"], ["downwind", "Downwind"], ["wolkenhof", "Flughafen Wolkenhof"],
  ["cockpit", "Cockpit"], ["firma", "Firma (QNH GmbH)"], ["secondseat", "SecondSeat"], ["metar", "METAR & TAF Trainer"],
  ["hotelbravo", "Hotel Bravo"], ["familycall", "FamilyCall"], ["briefing", "Briefing-Tool"], ["nachgeflogen", "Nachgeflogen"],
];
export const projectName = (key) => PROJECTS.find(([k]) => k === key)?.[1] ?? key;
export const STATUS = { open: "wartet auf Claude", doing: "Claude arbeitet daran", done: "erledigt", failed: "ging nicht", cancelled: "zurückgezogen" };

const demoRows = [
  { id: "m1", scope: "leesidelab", body: "Mach für Dezember eine Serie über Nebel im Mittelland.", status: "done", reply: "4 Ideen im Studio vorgeschlagen (1., 3., 5. und 8.12.).", created_at: "2026-10-28T07:10:00Z", updated_at: "2026-10-28T07:52:00Z" },
  { id: "m2", scope: "general", body: "Schau, dass die Rechnungen von Infomaniak im Cockpit sind.", status: "open", reply: null, created_at: "2026-10-28T17:00:00Z", updated_at: "2026-10-28T17:00:00Z" },
];
let demoN = 10;

// null = migration missing
export async function loadInbox() {
  if (DEMO) return structuredClone(demoRows);
  const r = await sb().from("claude_inbox").select("*").order("created_at", { ascending: false }).limit(200);
  if (r.error && /does not exist|could not find/i.test(r.error.message)) return null;
  return must(r);
}
export async function addInstruction(scope, body) {
  if (DEMO) { demoRows.unshift({ id: `m${++demoN}`, scope, body, status: "open", reply: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); return; }
  must(await sb().from("claude_inbox").insert({ scope, body }));
}
// only while Claude has not started on it
export async function cancelInstruction(id) {
  if (DEMO) { const r = demoRows.find((x) => x.id === id); if (r?.status === "open") r.status = "cancelled"; return; }
  must(await sb().from("claude_inbox").update({ status: "cancelled" }).eq("id", id).eq("status", "open"));
}
export function subscribe(onChange) {
  if (DEMO) return () => {};
  const ch = sb().channel("claude-inbox").on("postgres_changes", { event: "*", schema: "public", table: "claude_inbox" }, onChange).subscribe();
  return () => sb().removeChannel(ch);
}
