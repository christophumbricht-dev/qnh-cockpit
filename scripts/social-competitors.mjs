// npm run social -- konkurrenz [--shorts] [--tage 60] [--json] [--holen]
// What stands out at the watched YouTube channels (Social → «Konkurrenz»), for Claude: pick the videos worth a closer
// look (open them in the browser, read the transcript, look at frames). Learn patterns, never copy pictures, sound or text.
// --holen asks social-publish for fresh numbers first (op competitors, read only).
import { channelSummary, fmtDuration, fmtViews, standouts, videoUrl } from "../src/social/competitors.js";

export async function competitors(sb, a) {
  if (a.holen) {
    const { data, error } = await sb.functions.invoke("social-publish", { body: { op: "competitors" } });
    if (error) throw new Error(`Holen ging nicht: ${error.message}`);
    for (const r of data?.results ?? []) if (r.status === "failed") console.log(`  ✗ ${r.handle}: ${r.error}`);
  }
  const since = new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 10);
  const must = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
  const ch = await sb.from("competitor_channels").select("*").order("created_at");
  if (ch.error && /competitor_channels/.test(ch.error.message)) throw new Error("«Konkurrenz» ist noch nicht eingerichtet: Migration 20261030100000_competitors.sql einspielen.");
  const channels = must(ch);
  const videos = must(await sb.from("competitor_videos").select("video_id, competitor_id, title, published_at, duration_s, is_short, thumbnail_url, tags").order("published_at", { ascending: false }).limit(2000));
  const days = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await sb.from("competitor_video_days").select("video_id, day, views").gte("day", since).order("day").range(from, from + 999));
    days.push(...page);
    if (page.length < 1000) break;
  }
  const names = new Map(channels.map((c) => [c.id, c.title || c.handle]));
  const top = standouts(videos, days, { shorts: !!a.shorts, withinDays: Number(a.tage ?? 60), limit: 15 });
  if (a.json) return console.log(JSON.stringify({ standouts: top, channels: channelSummary(channels, videos, days) }, null, 2));
  console.log(`\nAuffällig (${a.shorts ? "Shorts" : "lange Videos"}, letzte ${a.tage ?? 60} Tage):`);
  if (!top.length) console.log("  nichts (oder noch keine Zahlen)");
  for (const v of top) console.log(`  ${v.factor.toFixed(1).padStart(5)}×  ${fmtViews(v.views).padStart(10)}  ${fmtDuration(v.duration_s).padStart(7)}  ${names.get(v.competitor_id)}: ${v.title}\n          ${videoUrl(v)}`);
  console.log("\nKanäle:");
  for (const c of channelSummary(channels, videos, days)) {
    console.log(`  ${(c.title || c.handle).padEnd(32)} ${c.active ? "" : "(Pause) "}Abos ${fmtViews(c.subscribers)}, 30 Tage ${c.long30} lang / ${c.shorts30} Shorts, üblich ${fmtViews(c.longViews)} Aufrufe, ${fmtDuration(c.longLength)}${c.last_error ? `  ✗ ${c.last_error}` : ""}`);
  }
}
