// Small pure helpers (unit-tested in tests/format.test.mjs).

// a link only when it is http(s) – never javascript: or data: in an href
export const web = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? u : null);

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function relTime(date, now = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const sec = Math.round((now - d) / 1000);
  if (sec < 60) return "gerade eben";
  const min = Math.round(sec / 60);
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const days = Math.floor(h / 24);
  if (days === 1) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;
  return shortDate(d);
}

export function shortDate(date) {
  const d = new Date(date);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

export function num(n) {
  return n == null ? "–" : Number(n).toLocaleString("de-CH");
}

const SOURCES = {
  instagram: "Instagram",
  friends: "Freunde",
  airfield: "Flugplatz",
  club: "Club",
  search: "Suche",
  other: "Andere",
};
export const sourceLabel = (s) => SOURCES[s] ?? s ?? "";

// Turns a Supabase/Postgres error into a German sentence for the cockpit.
export function errorText(err) {
  if (!err) return "";
  // QR-bill and form checks carry their own German message (never «Der Code ist falsch …», which is about sign-in)
  if (err.name === "QrBillError") return err.message;
  if (err.code === "42501" || /Only admins/i.test(err.message ?? "")) return "Dieses Konto ist kein Admin dieser App.";
  if (err.code === "PGRST202") return "Diese Funktion fehlt noch in der Datenbank: In Supabase den SQL-Code aus supabase/apply-pending.sql von Downwind ausführen.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(err.message ?? "")) return "Keine Verbindung zum Server.";
  // only sign-in errors: a database "invalid input syntax" must show its own text
  if (/^Auth/.test(err.name ?? "") && /token has expired|invalid/i.test(err.message ?? "")) return "Der Code ist falsch oder abgelaufen.";
  if (/Signups not allowed|User not found/i.test(err.message ?? "")) return "Zu dieser E-Mail gibt es kein Konto.";
  if (/Moderators only/i.test(err.message ?? "")) return "Dieses Konto ist kein Moderator dieser App.";
  if (/cannot ban yourself/i.test(err.message ?? "")) return "Du kannst dich nicht selbst sperren.";
  return err.message ?? String(err);
}
