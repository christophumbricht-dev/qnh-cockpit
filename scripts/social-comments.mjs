// npm run social -- comments [fetch] [--all] [--app leesidelab] [--json]
// npm run social -- comments draft <id> "<antwort>"     reply suggestion (Christoph reads it and sends it himself)
// npm run social -- comments draft <id> --clear
//
// Lists comments on our Instagram posts and YouTube videos (table social_comments, Social → «Kommentare»).
// Claude may only suggest answers (column `draft`); sending is always Christoph's click in the cockpit.
import { fail } from "./qnh-session.mjs";
import { groupComments, isHeld, isOpen } from "../src/social/inbox.js";
import { formatZurich } from "../src/social/validate.js";

const PLATFORM = { instagram: "Instagram", youtube: "YouTube" };
const COLS = "id, account_id, remote_id, parent_remote_id, media_id, media_title, media_permalink, author, body, posted_at, like_count, own, held, status, draft, deleted_at";

async function op(sb, body) {
  const { data, error } = await sb.functions.invoke("social-publish", { body });
  if (error) fail(`${body.op}: ${(await error.context?.json?.().catch(() => null))?.error ?? error.message}`);
  return data;
}

export async function comments(sb, a) {
  const [sub, id, ...words] = a._;
  if (sub === "draft") return draft(sb, id, words.join(" "), a.clear);
  if (sub && sub !== "fetch") fail("Befehle: comments [fetch] [--all] [--app …] [--json] | comments draft <id> \"Antwort\" | comments draft <id> --clear");
  if (sub === "fetch") {
    for (const r of (await op(sb, { op: "comments" })).results ?? []) {
      if (!a.json) console.log(`↻ ${PLATFORM[r.platform] ?? r.platform} @${r.account}: ${r.status === "ok" ? `${r.new} neu` : r.error}`);
    }
  }
  const [{ data: accounts, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
    sb.from("social_accounts").select("id, app_id, platform, handle"),
    sb.from("social_comments").select(COLS).is("deleted_at", null).order("posted_at", { ascending: false }).limit(1000),
  ]);
  if (e1 || e2) fail(/does not exist|could not find/i.test((e1 ?? e2).message) ? "Tabelle social_comments fehlt – Migration 20261020100000_social_comments.sql einspielen." : (e1 ?? e2).message);
  const acc = new Map(accounts.map((x) => [x.id, x]));
  const posts = groupComments(rows, { filter: a.all ? "all" : "open", accountOk: (accountId) => !a.app || acc.get(accountId)?.app_id === a.app });
  if (a.json) return console.log(JSON.stringify(posts, null, 2));
  if (!posts.length) return console.log(a.all ? "Keine Kommentare." : "Keine offenen Kommentare.");
  for (const p of posts) {
    const x = acc.get(p.account_id);
    console.log(`\n■ ${PLATFORM[x?.platform] ?? x?.platform} @${x?.handle} · «${p.title || "(ohne Titel)"}»${p.permalink ? `  ${p.permalink}` : ""}`);
    for (const th of p.threads) {
      for (const c of [th.top, ...th.replies].filter(Boolean)) {
        const mark = isOpen(c) ? "●" : isHeld(c) ? "⏸" : c.own ? "↳" : " ";
        const indent = c.parent_remote_id ? "     " : "  ";
        console.log(`${indent}${mark} ${c.id.slice(0, 8)}  ${c.own ? "Du" : c.author} · ${formatZurich(c.posted_at)}${c.like_count ? ` · ♥ ${c.like_count}` : ""}${c.status === "hidden" ? " · ausgeblendet" : ""}`);
        console.log(`${indent}    ${c.body.split("\n").join(`\n${indent}    `)}`);
        if (c.draft) console.log(`${indent}    ✎ Vorschlag: ${c.draft}`);
      }
    }
  }
  console.log("\n● offen  ⏸ von YouTube zurückgehalten  ↳ deine Antwort. Vorschlag hinterlegen: npm run social -- comments draft <id> \"…\"");
}

async function draft(sb, prefix, text, clear) {
  if (!/^[0-9a-f-]{6,36}$/i.test(prefix ?? "")) fail("Kommentar-ID (mindestens die ersten 6 Zeichen) angeben.");
  if (!clear && !text.trim()) fail("Antworttext fehlt (oder --clear).");
  if (text.length > 2200) fail("Höchstens 2200 Zeichen.");
  const { data, error } = await sb.from("social_comments").select("id, author, body, own").is("deleted_at", null).limit(1000);
  if (error) fail(error.message);
  const hits = data.filter((c) => c.id.startsWith(prefix.toLowerCase()));
  if (hits.length !== 1) fail(hits.length ? `«${prefix}» ist nicht eindeutig – mehr Zeichen angeben.` : `Kein Kommentar «${prefix}».`);
  if (hits[0].own) fail("Das ist deine eigene Antwort.");
  const { error: e2 } = await sb.from("social_comments").update({ draft: clear ? "" : text.trim() }).eq("id", hits[0].id);
  if (e2) fail(e2.message);
  console.log(clear ? "Vorschlag gelöscht." : `✎ Vorschlag für ${hits[0].author} gespeichert – Christoph liest und sendet ihn im Cockpit (Social → Kommentare).`);
}
