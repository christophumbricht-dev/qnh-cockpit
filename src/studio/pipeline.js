// YouTube-Ablauf (28.10.2026, Christoph): every YouTube video runs through four steps, planned in 4-week blocks.
//   1 Idee (grey)       Claude proposes what, when, which channel; Christoph confirms the idea
//   2 Entwurf (blue)    Claude makes a cheap draft (Windows voice, simple video); Christoph gives input
//   3 Video (orange)    Claude makes the real video; Sichtung 1
//   4 Feinschliff (yellow)  Claude polishes; Sichtung 2 and approval
//   5 bereit (green)    approved, waits for publishing or is out
// Red is only for «late»: a step not done by its deadline (days before the air date). Pure, tested in tests/studio-pipeline.test.mjs.
import { addDaysIso } from "../social/weekplan.js";

// what runs through the Ablauf (Christoph 28.10.2026): the long YouTube videos (2 a week, the Shorts not) and the
// Leeside Instagram reels (6 a week; Saturday is the METAR carousel)
export const PIPELINE = [
  { channel: "leesidelab/youtube", format: "video_long", perWeek: 2, label: "lange Videos" },
  { channel: "leesidelab/instagram", format: "reel", perWeek: 6, label: "Reels" },
];
export const PIPELINE_CHANNELS = PIPELINE.map((p) => p.channel);
export const inPipeline = (channel, format) => PIPELINE.some((p) => p.channel === channel && p.format === format);

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
// → [{ channel, perWeek, weeks: [{ monday, count, missing, late, days: [{ date, items, phase, late }] }] }]
export function pipelineBlock(items, monday, today, weeks = 4, pipeline = PIPELINE) {
  return pipeline.map(({ channel, format, perWeek, label }) => {
    const mine = items.filter((i) => i.channel === channel && i.format === format && i.status !== "dropped" && i.day);
    return {
      channel, perWeek, label,
      weeks: Array.from({ length: weeks }, (_, w) => {
        const m = addDaysIso(monday, 7 * w);
        const days = Array.from({ length: 7 }, (_, d) => {
          const date = addDaysIso(m, d);
          const list = mine.filter((i) => i.day === date);
          const weakest = list.length ? list.reduce((a, b) => (phaseOf(b.status).n < phaseOf(a.status).n ? b : a)) : null;
          return { date, items: list, phase: phaseOf(weakest?.status ?? null), late: weakest && date >= today ? isLate(weakest.status, date, today) : false };
        });
        const count = days.reduce((n, d) => n + d.items.length, 0);
        const missing = Math.max(0, perWeek - count);
        return { monday: m, count, missing, late: missing > 0 && addDaysIso(m, 6) >= today && today > deadline(m, 1), days };
      }),
    };
  });
}
