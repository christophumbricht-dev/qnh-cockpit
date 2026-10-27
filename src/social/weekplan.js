// Standardwoche (26.10.2026, Christoph: «jeden Tag auf jedem Kanal»): what goes out on which weekday, per channel.
// Social → «Wochenplan» shows it next to what is really planned in that week (pure, tested in tests/weekplan.test.mjs).
// Changing the plan: edit WEEKPLAN here (and the matching section in C:\QNH\CLAUDE.md / the channel plans).

export const WEEK_DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// slot: day 0 = Monday; `alt` = what runs in weeks without a topic package (Unfall-/Instrument-Reel)
export const WEEKPLAN = [
  {
    app_id: "leesidelab", platform: "instagram", slots: [
      { day: 0, time: "18:00", format: "Wetter-Serie, Teil 1", note: "Reel mit Stimme" },
      { day: 1, time: "18:00", format: "Unfall-Reel", alt: "Reel «Wind im Griff» (Serie A)", note: "Unfall in Paketwochen, sonst Serie A (seit 27.10.2026 statt Karussell)" },
      { day: 2, time: "18:00", format: "Wetter-Serie, Teil 2", note: "Reel mit Stimme" },
      { day: 3, time: "18:00", format: "Instrument-Reel", alt: "Reel «Woher kommt das Wetter?» (Serie B)", note: "Instrument in Paketwochen, sonst Serie B (seit 27.10.2026 statt Karussell)" },
      { day: 4, time: "18:00", format: "Wetter-Serie, Teil 3", note: "Reel mit Stimme" },
      { day: 5, time: "18:00", format: "METAR of the week", note: "Karussell-Quiz, Auflösung im Kommentar" },
      { day: 6, time: "18:00", format: "Panel Puzzle", note: "Quiz im Kommentar, Auflösung nach 4 h" },
    ],
  },
  {
    app_id: "leesidelab", platform: "youtube", slots: [
      { day: 0, time: "19:00", format: "Wetter-Serie, Teil 1", note: "Short" },
      { day: 1, time: "19:00", format: "Unfall-Reel", alt: "Short «Wind im Griff» (Serie A)", note: "Unfall in Paketwochen, sonst Serie A oder ein Kapitel aus einem Langvideo" },
      { day: 2, time: "19:00", format: "Wetter-Serie, Teil 2", note: "Short" },
      { day: 3, time: "19:00", format: "Instrument-Reel", alt: "Short «Woher kommt das Wetter?» (Serie B)", note: "Instrument in Paketwochen, sonst Serie B oder ein Kapitel aus einem Langvideo" },
      { day: 4, time: "19:00", format: "Wetter-Serie, Teil 3", note: "Short" },
      { day: 5, time: "19:00", format: "METAR of the week", note: "Short" },
      { day: 6, time: "19:00", format: "Panel Puzzle", note: "Short" },
    ],
  },
  {
    app_id: "downwind", platform: "instagram", slots: [
      { day: 0, time: "18:00", format: "Karussell", note: "Flugplätze, Tipps, Hintergrund" },
      { day: 1, time: "18:00", format: "Flugplatz-Tipp", note: "Bild und kurzer Text" },
      { day: 2, time: "18:00", format: "Karussell oder Bild", note: "App und Fliegen" },
      { day: 3, time: "18:00", format: "App-Funktion in 15 Sekunden", note: "Reel mit Downwind Theme (dazu Storys)" },
      { day: 4, time: "18:00", format: "Bild oder Karussell", note: "" },
      { day: 5, time: "09:00", format: "Flug-Reel", note: "App-Replay mit Downwind Theme" },
      { day: 6, time: "18:00", format: "Foto der Woche", note: "eigene Fotos oder Jürg mit Bildnachweis" },
    ],
  },
];

export const addDaysIso = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// Monday (YYYY-MM-DD) of the week of a Swiss calendar day
export const mondayOf = (day) => addDaysIso(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

const RANK = { failed: 0, empty: 1, placeholder: 2, draft: 3, ok: 4 };
// what a post means for its slot: «ok» (approved/out), draft, placeholder (video missing), failed
export function postState(p, isPlaceholder) {
  if (p.status === "failed") return "failed";
  if (p.status === "approved" || p.status === "publishing" || p.status === "published") return "ok";
  return isPlaceholder(p) ? "placeholder" : "draft";
}

// the plan for the week starting `monday`, filled with the posts of that week. `swissDay(iso)` → YYYY-MM-DD.
// → [{ channel, account, days: [{ slot, date, posts, state }] }]; state = the weakest of the day's posts, «empty» if none
export function weekGrid(plan, posts, accounts, monday, { swissDay, isPlaceholder }) {
  return plan.map((channel) => {
    const account = accounts.find((a) => a.app_id === channel.app_id && a.platform === channel.platform) ?? null;
    const mine = account ? posts.filter((p) => p.account_id === account.id && p.status !== "cancelled" && p.scheduled_at) : [];
    const days = channel.slots.map((slot) => {
      const date = addDaysIso(monday, slot.day);
      const list = mine.filter((p) => swissDay(p.scheduled_at) === date).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
      const states = list.map((p) => postState(p, isPlaceholder));
      const state = states.length ? states.reduce((a, b) => (RANK[b] < RANK[a] ? b : a)) : "empty";
      return { slot, date, posts: list, state };
    });
    return { channel, account, days };
  });
}

// how full the week is per channel: { ok, total } (a day counts when its posts are approved or out)
export const weekScore = (row) => ({ ok: row.days.filter((d) => d.state === "ok").length, total: row.days.length });
