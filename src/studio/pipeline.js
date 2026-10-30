// YouTube-Ablauf (28.10.2026, Christoph): every YouTube video runs through four steps, planned in 4-week blocks.
//   1 Idee (grey)       Claude proposes what, when, which channel; Christoph confirms the idea
//   2 Entwurf (blue)    Claude makes a cheap draft (Windows voice, simple video); Christoph gives input
//   3 Video (orange)    Claude makes the real video; Sichtung 1
//   4 Feinschliff (yellow)  Claude polishes; Sichtung 2 and approval
//   5 bereit (green)    approved, waits for publishing or is out
// Red is only for «late»: a step not done by its deadline (days before the air date). Pure, tested in tests/studio-pipeline.test.mjs.
import { WEEKPLAN, addDaysIso } from "../social/weekplan.js";

// what runs through the Ablauf (Christoph 28.10.2026): the long YouTube videos (2 a week, the Shorts not) and the
// Instagram of Leeside and Downwind with every format, reel, carousel, picture or story (7 a week each; «es soll alles
// durchs Studio durch»). formats null = all formats.
export const PIPELINE = [
  // from December 3 a week on fixed days: Wednesday, Friday (accident case) and Sunday (Christoph 30.10.2026)
  { channel: "leesidelab/youtube", formats: ["video_long"], perWeek: 2, label: "lange Videos, 2 pro Woche, ab Dezember 3: Mi, Fr Unfall, So",
    from: [{ monday: "2026-11-30", perWeek: 3, days: [2, 4, 6] }] },
  { channel: "leesidelab/instagram", formats: null, perWeek: 7, label: "Instagram" },
  { channel: "downwind/instagram", formats: null, perWeek: 7, label: "Instagram" },
];
export const PIPELINE_CHANNELS = PIPELINE.map((p) => p.channel);
// the rows of the Ablauf block: the Ablauf plus the YouTube Shorts (Christoph 30.10.2026 «zeige die auch im Studio»).
// The Shorts get no idea and no draft (mostly the Instagram reel with another ending), only the two looks: a Short
// with its video is in step 3 Video (Sichtung 1), then Feinschliff
export const BLOCK_ROWS = [
  PIPELINE[0],
  { channel: "leesidelab/youtube", formats: ["short"], perWeek: 7, label: "Shorts, 1 pro Tag", looksOnly: true },
  ...PIPELINE.slice(1),
];
export const inPipeline = (channel, format) => PIPELINE.some((p) => p.channel === channel && (!p.formats || p.formats.includes(format)));

export const STEPS = [
  null,
  { n: 1, color: "grey", name: "Idee" },
  { n: 2, color: "blue", name: "Entwurf" },
  { n: 3, color: "orange", name: "Video" },
  { n: 4, color: "yellow", name: "Feinschliff" },
  { n: 5, color: "green", name: "bereit" },
];
// item status → step and whose turn it is (null status = nothing proposed yet)
const PHASE = {
  none: [1, "claude", "noch keine Idee"],
  idea: [1, "christoph", "Idee wartet auf dich"],
  idea_ok: [2, "claude", "Claude macht den Entwurf"],
  draft: [2, "christoph", "Entwurf ansehen"],
  draft_done: [3, "claude", "Claude macht das Video"],
  review1: [3, "christoph", "Sichtung 1"],
  work: [4, "claude", "Claude macht den Feinschliff"],
  review2: [4, "christoph", "Sichtung 2 und Freigabe"],
  approved: [5, null, "freigegeben"],
};
// days before the air date by which a step must be done
export const DEADLINE_DAYS = { 1: 21, 2: 14, 3: 7, 4: 3 };

export function phaseOf(status) {
  const [n, who, label] = PHASE[status ?? "none"] ?? PHASE.none;
  return { ...STEPS[n], who, label };
}
export const deadline = (day, step) => (DEADLINE_DAYS[step] ? addDaysIso(day, -DEADLINE_DAYS[step]) : null);
// late: the current step should have been done by now
export function isLate(status, day, today) {
  const p = phaseOf(status);
  const d = day && deadline(day, p.n);
  return !!d && today > d;
}

// Christoph finished looking at a draft or a version
export const afterReview = (status) => (status === "draft" ? "draft_done" : "work");
// a new version arrives (upload or import)
export function afterNewVersion(status) {
  if (status === "idea" || status === "idea_ok" || status === "draft") return "draft";
  if (status === "draft_done" || status === "review1") return "review1";
  return "review2";
}
// statuses in which Christoph is looking at something in the studio (player, markers)
export const LOOKING = ["draft", "review1", "review2"];
export const christophsTurn = (status) => phaseOf(status).who === "christoph";

// 4-week block of the Ablauf: per channel, per day the long videos of that day (no fixed weekdays: a day without
// one is just free), per week how many are planned against the goal; a week is short of videos («missing») when it
// has fewer than perWeek items and its idea deadline (21 days before its Monday) has passed
// → [{ channel, perWeek, weeks: [{ monday, count, missing, late, days: [{ date, items, phase, late, entries }] }] }]
// entries: one per item with its own phase and «late», shown one below the other (Christoph 30.10.2026 «wenn es zwei
// posts hat, zeige sie untereinander an»), ordered by air time (timeOf: item → ISO time of its Social post, or null),
// else by creation
export function pipelineBlock(items, monday, today, weeks = 4, pipeline = PIPELINE, timeOf = () => null) {
  // a post without a time comes after those with one
  const at = (i) => { const t = timeOf(i); return t ? new Date(t).getTime() : Infinity; };
  const byTime = (a, b) => at(a) - at(b) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  return pipeline.map(({ channel, formats, perWeek, label, looksOnly = false, from = [] }) => {
    // the goal of a week: the latest period that has started by its Monday (days: fixed weekdays, 0 = Monday)
    const goal = (m) => [...from].sort((a, b) => a.monday.localeCompare(b.monday)).filter((p) => p.monday <= m).at(-1) ?? { perWeek, days: null };
    const [app_id, platform] = channel.split("/");
    // the standard week: Instagram, and the YouTube week (all Shorts)
    const plan = WEEKPLAN.find((c) => c.app_id === app_id && c.platform === platform && (formats == null || looksOnly));
    const mine = items.filter((i) => i.channel === channel && (!formats || formats.includes(i.format)) && i.status !== "dropped" && i.day);
    return {
      channel, perWeek, label, looksOnly,
      weeks: Array.from({ length: weeks }, (_, w) => {
        const m = addDaysIso(monday, 7 * w);
        const { perWeek: weekGoal, days: fixed } = goal(m);
        const count = mine.filter((i) => i.day >= m && i.day <= addDaysIso(m, 6)).length;
        const days = Array.from({ length: 7 }, (_, d) => {
          const date = addDaysIso(m, d);
          const list = mine.filter((i) => i.day === date).sort(byTime);
          const weakest = list.length ? list.reduce((a, b) => (phaseOf(b.status).n < phaseOf(a.status).n ? b : a)) : null;
          const slot = plan?.slots.find((s) => s.day === d) ?? null;
          // «N/A» (Christoph 30.10.2026): a day with nothing on purpose; with a standard week a day without its slot,
          // without one (long videos) the days that are not fixed, or with no fixed days the free days of a week
          // that already has its goal
          const off = !list.length && (plan ? !slot : fixed ? !fixed.includes(d) : count >= weekGoal);
          const lateOf = (i) => date >= today && isLate(i.status, date, today);
          const entries = list.map((i) => ({ item: i, phase: phaseOf(i.status), late: lateOf(i) }));
          return { date, slot, items: list, entries, off, phase: phaseOf(weakest?.status ?? null), late: weakest ? lateOf(weakest) : false };
        });
        const missing = Math.max(0, weekGoal - count);
        // without ideas a missing Short is not late (it simply is not made yet)
        return { monday: m, perWeek: weekGoal, count, missing, late: !looksOnly && missing > 0 && addDaysIso(m, 6) >= today && today > deadline(m, 1), days };
      }),
    };
  });
}
