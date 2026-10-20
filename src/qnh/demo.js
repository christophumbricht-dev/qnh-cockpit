// ?demo: invented roadmap items and links, in memory.
const now = () => new Date().toISOString();
const wait = (v) => new Promise((r) => setTimeout(() => r(structuredClone(v)), 120));
let n = 100;

const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const items = [
  { id: "r7", scope: "qnh", title: "MWST-Abrechnung vorbereiten", body: "Belege aus kDrive an den Treuhänder.", status: "next", due: inDays(2), sort: 0, source: "cockpit", created_at: now(), repeat: "quarterly", snoozed_until: null },
  { id: "r8", scope: "downwind", title: "Datenschutzerklärung überprüfen", body: "", status: "next", due: inDays(-1), sort: 0, source: "claude", created_at: now(), repeat: null, snoozed_until: null },
  { id: "r9", scope: "leesidelab", title: "Wochenplanung Reels", body: "", status: "next", due: inDays(0), sort: 0, source: "cockpit", created_at: now(), repeat: "weekly", snoozed_until: null },
  { id: "r1", scope: "qnh", title: "GmbH gründen", body: "Statuten, Notar, Handelsregister – Ziel Ende November.", status: "doing", due: "2026-11-30", sort: 0, source: "claude", created_at: now(), repeat: null, snoozed_until: null },
  { id: "r2", scope: "qnh", title: "Apple Developer als Organisation", body: "Braucht D-U-N-S-Nummer.", status: "next", due: "2026-12-05", sort: 0, source: "claude", created_at: now(), repeat: null, snoozed_until: null },
  { id: "r3", scope: "downwind", title: "Bundle-IDs auf ch.setqnh.* umstellen", body: "Vor dem öffentlichen Release, zusammen mit dem Firmen-Account.", status: "next", due: "2026-12-15", sort: 1, source: "claude", created_at: now(), repeat: null, snoozed_until: null },
  { id: "r4", scope: "downwind", title: "Logbuch-Export als PDF", body: "Wunsch aus dem Feedback.", status: "idea", due: null, sort: 0, source: "cockpit", created_at: now(), repeat: null, snoozed_until: null },
  { id: "r5", scope: "secondseat", title: "Audio-Prototyp mit Bose A30 testen", body: "", status: "doing", due: null, sort: 0, source: "cockpit", created_at: now(), repeat: null, snoozed_until: null },
  { id: "r6", scope: "qnh", title: "Website setqnh.ch online", body: "", status: "done", due: null, sort: 0, source: "claude", created_at: now(), done_at: now(), repeat: null, snoozed_until: null },
];
const linkRows = [
  { id: "l1", grp: "Ablage", title: "kDrive", url: "https://kdrive.infomaniak.com", note: "Präsentationen, Verträge, Belege", sort: 10 },
  { id: "l2", grp: "Entwicklung", title: "GitHub", url: "https://github.com/christophumbricht-dev", note: "Alle Repositories", sort: 10 },
  { id: "l3", grp: "Entwicklung", title: "Supabase", url: "https://supabase.com/dashboard/projects", note: "Datenbanken", sort: 30 },
  { id: "l4", grp: "Apple", title: "App Store Connect", url: "https://appstoreconnect.apple.com", note: "Apps, TestFlight, Bewertungen", sort: 10 },
  { id: "l5", grp: "Webseiten", title: "setqnh.ch", url: "https://setqnh.ch", note: "Firmen-Website", sort: 10 },
];

export const roadmap = () => wait(items);
export function addItem(row) { const it = { id: `r${++n}`, status: "idea", body: "", sort: 0, source: "cockpit", created_at: now(), ...row }; items.push(it); return wait(it); }
export function updateItem(id, patch) { const it = items.find((x) => x.id === id); Object.assign(it, patch); if (patch.status) it.done_at = patch.status === "done" ? now() : null; return wait(it); }
export function deleteItem(id) { items.splice(items.findIndex((x) => x.id === id), 1); return wait(null); }
export const links = () => wait(linkRows);
export function saveLink(link) {
  if (link.id) { Object.assign(linkRows.find((x) => x.id === link.id), link); return wait(link); }
  const l = { ...link, id: `l${++n}` }; linkRows.push(l); return wait(l);
}
export function deleteLink(id) { linkRows.splice(linkRows.findIndex((x) => x.id === id), 1); return wait(null); }
