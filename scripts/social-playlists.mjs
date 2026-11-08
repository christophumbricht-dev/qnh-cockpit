// YouTube playlists from a list of rules (Christoph 8.11.2026): npm run social -- playlists <regeln.json> [--dry]
// regeln.json: { "app": "leesidelab", "playlists": [{ "title", "description", "muster": "<regex on the studio slug>" }] }
// Every published video whose studio slug matches goes into the playlist (oldest first). Adds only, never removes.
import { readFileSync } from "node:fs";

export async function playlists(sb, file, dry = false) {
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  const acc = (await sb.from("social_accounts").select("id").eq("app_id", cfg.app).eq("platform", "youtube").single()).data;
  if (!acc) throw new Error(`Kein YouTube-Konto für ${cfg.app}.`);
  const posts = (await sb.from("social_posts").select("id, remote_media_id, published_at").eq("account_id", acc.id).eq("status", "published")).data ?? [];
  const items = (await sb.from("studio_items").select("slug, social_post_id")).data ?? [];
  const slugOf = new Map(items.filter((i) => i.social_post_id).map((i) => [i.social_post_id, i.slug]));
  const done = posts.filter((p) => p.remote_media_id && slugOf.has(p.id)).sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)));
  const wanted = cfg.playlists.map((p) => {
    const re = new RegExp(p.muster);
    return { title: p.title, description: p.description ?? "", videos: done.filter((x) => re.test(slugOf.get(x.id))).map((x) => x.remote_media_id) };
  });
  for (const w of wanted) console.log(`${w.title}: ${w.videos.length} veröffentlichte Videos`);
  if (dry || !wanted.some((w) => w.videos.length)) return;
  const { data, error } = await sb.functions.invoke("social-publish", { body: { op: "playlists", app_id: cfg.app, playlists: wanted } });
  if (error || data?.error) throw new Error(`Playlists: ${data?.error ?? error.message}`);
  for (const r of data.results ?? []) console.log(`✓ ${r.title}: ${r.made ? "neu angelegt, " : ""}${r.added} ergänzt, ${r.total} total`);
}
