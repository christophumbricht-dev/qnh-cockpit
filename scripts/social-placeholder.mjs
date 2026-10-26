// npm run social -- platzhalter <app/plattform> <YYYY-MM-DD> <HH:MM> "Was kommt" [--kind reel] [--topic "…"]
//   holds the day in the cockpit calendar for a post whose video is not ready yet (draft without media, cannot be
//   approved). The import cancels it as soon as the real package for the same account and day comes in.
//   npm run social -- platzhalter list    shows the open placeholders
import { fail } from "./qnh-session.mjs";
import { PLACEHOLDER, isPlaceholder } from "./social-lib.mjs";
import { KINDS, formatZurich, zurichToUtc } from "../src/social/validate.js";

export async function placeholder(sb, a) {
  const [first, day, time, text] = a._;
  const { data: accounts, error: e1 } = await sb.from("social_accounts").select("id, app_id, platform, handle");
  if (e1) fail(e1.message);
  if (first === "list") {
    const { data, error } = await sb.from("social_posts").select("id, account_id, caption, media, status, scheduled_at").eq("status", "draft").like("caption", `${PLACEHOLDER}%`).order("scheduled_at");
    if (error) fail(error.message);
    const rows = data.filter(isPlaceholder);
    for (const p of rows) { const acc = accounts.find((x) => x.id === p.account_id); console.log(`${formatZurich(p.scheduled_at)}  ${acc?.app_id}/${acc?.platform}  ${p.caption}`); }
    return console.log(`${rows.length} Platzhalter.`);
  }
  const [app, platform = "instagram"] = String(first ?? "").split("/");
  const acc = accounts.find((x) => x.app_id === app && x.platform === platform);
  if (!acc) fail(`Konto «${first}» nicht gefunden (z. B. leesidelab/instagram).`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "") || !/^\d{2}:\d{2}$/.test(time ?? "")) fail("Datum und Zeit: 2026-11-08 18:00");
  if (!String(text ?? "").trim()) fail('Was kommt? z. B. "Panel Puzzle 1: kalter Motor"');
  const kind = a.kind ?? "reel";
  if (!KINDS[kind]) fail(`Art «${kind}» gibt es nicht.`);
  const row = { account_id: acc.id, kind, caption: `${PLACEHOLDER} · ${text.trim()}`, first_comment: "", media: [], scheduled_at: zurichToUtc(`${day}T${time}`),
    ...(a.topic ? { topic: a.topic } : {}) };
  const { data, error } = await sb.from("social_posts").insert({ id: crypto.randomUUID(), ...row, source: "editor" }).select("id, scheduled_at").single();
  if (error) fail(error.message);
  console.log(`✓ Platzhalter ${formatZurich(data.scheduled_at)} · ${app}/${platform} · ${text.trim()}`);
}
