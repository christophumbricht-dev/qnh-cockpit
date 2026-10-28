// YouTube-Ablauf (28.10.2026, Christoph): every YouTube video runs through four steps, planned in 4-week blocks.
//   1 Idee (grey)       Claude proposes what, when, which channel; Christoph confirms the idea
//   2 Entwurf (blue)    Claude makes a cheap draft (Windows voice, simple video); Christoph gives input
//   3 Video (orange)    Claude makes the real video; Sichtung 1
//   4 Feinschliff (yellow)  Claude polishes; Sichtung 2 and approval
//   5 bereit (green)    approved, waits for publishing or is out
// Red is only for «late»: a step not done by its deadline (days before the air date). Pure, tested in tests/studio-pipeline.test.mjs.
import { WEEKPLAN, addDaysIso } from "../social/weekplan.js";

// channels that run through the Ablauf
export const PIPELINE_CHANNELS = ["leesidelab/youtube"];
export const inPipeline = (channel) => PIPELINE_CHANNELS.includes(channel);

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

// 4-week block of the Ablauf: per channel, per day the planned slot and the items of that day
// → [{ channel, weeks: [{ monday, days: [{ date, slot, items, phase, late }] }] }]  (phase/late of the weakest item)
export function pipelineBlock(items, monday, today, weeks = 4, channels = PIPELINE_CHANNELS) {
  return channels.map((channel) => {
    const [app_id, platform] = channel.split("/");
    const plan = WEEKPLAN.find((c) => c.app_id === app_id && c.platform === platform);
    const mine = items.filter((i) => i.channel === channel && i.status !== "dropped" && i.day);
    return {
      channel,
      weeks: Array.from({ length: weeks }, (_, w) => {
        const m = addDaysIso(monday, 7 * w);
        return {
          monday: m,
          days: Array.from({ length: 7 }, (_, d) => {
            const date = addDaysIso(m, d);
            const list = mine.filter((i) => i.day === date);
            const weakest = list.length ? list.reduce((a, b) => (phaseOf(b.status).n < phaseOf(a.status).n ? b : a)) : null;
            const status = weakest?.status ?? null;
            const slot = plan?.slots.find((s) => s.day === d) ?? null;
            return { date, slot, items: list, phase: phaseOf(status), late: (slot || list.length) && date >= today ? isLate(status, date, today) : false };
          }),
        };
      }),
    };
  });
}
