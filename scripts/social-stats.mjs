// npm run social -- stats [--app downwind|leesidelab] [--days 28] [--json] [--refresh]
// Reads the daily Instagram statistics from QNH Core (tables social_account_stats / social_media_stats).
// --refresh first asks social-publish to fetch today's numbers (otherwise the daily job at ~06:23 does it).
import { fail } from "./qnh-session.mjs";

const COLS = [["views", "Views"], ["reach", "Reichw."], ["likes", "Likes"], ["comments", "Komm."], ["saved", "Gesp."], ["shares", "Geteilt"], ["follows", "Follows"]];
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const num = (v) => (v == null ? "–" : Number.isInteger(v) ? String(v) : v.toFixed(1));

export async function stats(sb, a) {
  const days = Number(a.days ?? 28);
  if (!(days > 0 && days <= 730)) fail("--days zwischen 1 und 730");
  if (a.refresh) {
    const { data, error } = await sb.functions.invoke("social-publish", { body: { op: "stats" } });
    if (error) fail(`Abholen fehlgeschlagen: ${(await error.context?.json?.().catch(() => null))?.error ?? error.message}`);
    for (const r of data?.results ?? []) if (!a.json) console.log(`↻ @${r.account}: ${r.status === "ok" ? `${r.media} Beiträge, ${r.followers ?? "?"} Follower` : r.error}`);
  }
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const { data: accounts, error: e1 } = await sb.from("social_accounts").select("id, app_id, handle");
  if (e1) fail(e1.message);
  const chosen = accounts.filter((x) => !a.app || x.app_id === a.app);
  if (!chosen.length) fail(`Kein Konto für «${a.app}». Vorhanden: ${accounts.map((x) => x.app_id).join(", ")}`);
  const ids = chosen.map((x) => x.id);
  const [{ data: accDays, error: e2 }, { data: mediaDays, error: e3 }, { data: posts }] = await Promise.all([
    sb.from("social_account_stats").select("account_id, day, metrics").in("account_id", ids).gte("day", since).order("day"),
    sb.from("social_media_stats").select("media_id, account_id, day, kind, permalink, caption, posted_at, metrics").in("account_id", ids).order("day"),
    sb.from("social_posts").select("id, remote_media_id, source, scheduled_at").not("remote_media_id", "is", null),
  ]);
  if (e2 || e3) fail(/does not exist|could not find/i.test((e2 ?? e3).message) ? "Statistik-Tabellen fehlen – Migration 20261019120000_social_stats.sql einspielen." : (e2 ?? e3).message);

  const out = chosen.map((acc) => {
    const series = accDays.filter((d) => d.account_id === acc.id);
    const last = series.at(-1)?.metrics ?? {};
    const first = series[0]?.metrics ?? {};
    const sum = (k) => series.reduce((s, d) => s + (typeof d.metrics[k] === "number" ? d.metrics[k] : 0), 0);
    // latest snapshot per media item, posted within the period
    const latest = new Map();
    for (const m of mediaDays.filter((x) => x.account_id === acc.id)) latest.set(m.media_id, m);
    const media = [...latest.values()]
      .filter((m) => !m.posted_at || m.posted_at.slice(0, 10) >= since)
      .map((m) => ({ ...m, cockpit: posts?.some((p) => p.remote_media_id === m.media_id) ?? false }))
      .sort((x, y) => String(y.posted_at).localeCompare(String(x.posted_at)));
    return {
      app: acc.app_id, handle: acc.handle, days, since,
      followers: last.followers_count ?? null, followers_change: last.followers_count != null && first.followers_count != null ? last.followers_count - first.followers_count : null,
      totals: { reach: sum("reach"), views: sum("views"), interactions: sum("total_interactions"), profile_links_taps: sum("profile_links_taps"), accounts_engaged_last_day: last.accounts_engaged ?? null },
      follower_series: series.map((d) => [d.day, d.metrics.followers_count ?? null]),
      media: media.map((m) => ({ media_id: m.media_id, posted_at: m.posted_at, kind: m.kind, permalink: m.permalink, caption: m.caption.split("\n")[0].slice(0, 80), via_cockpit: m.cockpit, as_of: m.day, metrics: m.metrics })),
    };
  });

  if (a.json) return console.log(JSON.stringify(out, null, 2));
  for (const r of out) {
    console.log(`\n@${r.handle} (${r.app}) · letzte ${r.days} Tage (ab ${r.since})`);
    if (!r.media.length && r.followers == null) { console.log("  noch keine Daten – nach dem ersten Abholen (täglich ~06:23 oder --refresh) erscheinen sie hier"); continue; }
    console.log(`  Follower ${num(r.followers)}${r.followers_change != null ? ` (${r.followers_change >= 0 ? "+" : ""}${r.followers_change})` : ""} · Reichweite ${r.totals.reach} · Views ${r.totals.views} · Interaktionen ${r.totals.interactions} · Link-Taps ${r.totals.profile_links_taps}`);
    console.log(`  ${pad("Datum", 10)} ${pad("Art", 8)} ${COLS.map(([, l]) => pad(l, 7)).join(" ")}  Beitrag`);
    for (const m of r.media) {
      console.log(`  ${pad((m.posted_at ?? "").slice(0, 10), 10)} ${pad(m.kind, 8)} ${COLS.map(([k]) => pad(num(m.metrics[k]), 7)).join(" ")}  ${m.caption}${m.via_cockpit ? "" : " (nicht via Cockpit)"}`);
    }
  }
}
