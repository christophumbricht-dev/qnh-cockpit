// Search for the Ctrl+K palette – pure functions, unit-tested (tests/search.test.mjs).

export const normalize = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// groups: [{ title, items: [{ label, sub?, text?, ...payload }] }] → same shape, only matches.
// Every word of the query must appear in label, sub or text. Empty query: only the first group (pages).
export function search(query, groups, perGroup = 6) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return groups.slice(0, 1).map((g) => ({ ...g, items: g.items.slice(0, 8) }));
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => {
        const hay = normalize(`${it.label} ${it.sub ?? ""} ${it.text ?? ""}`);
        return words.every((w) => hay.includes(w));
      }).slice(0, perGroup),
    }))
    .filter((g) => g.items.length);
}

export function greeting(date = new Date()) {
  const parts = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "numeric", hourCycle: "h23" }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  return h < 5 ? "Gute Nacht" : h < 11 ? "Guten Morgen" : h < 17 ? "Guten Tag" : h < 22 ? "Guten Abend" : "Gute Nacht";
}

// "christoph.umbricht@…" → "Christoph"
export function firstName(email) {
  const part = String(email ?? "").split("@")[0].split(/[._-]/)[0];
  return part ? part[0].toUpperCase() + part.slice(1) : "";
}
