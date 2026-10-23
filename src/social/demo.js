// ?demo: invented social accounts and posts, kept in memory. Publishing is simulated.
const day = 864e5;
const at = (days, hour) => { const d = new Date(Date.now() + days * day); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
const IMG = "icon.svg";
const files = new Map();
const listeners = new Set();
const emit = () => setTimeout(() => listeners.forEach((f) => f()), 0);
const clone = (v) => structuredClone(v);
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));

const accounts = [
  { id: "acc-dw", app_id: "downwind", platform: "instagram", handle: "fly_downwind", active: true, token_expires_at: at(41, 0) },
  { id: "acc-ss", app_id: "secondseat", platform: "instagram", handle: "secondseat.app", active: true, token_expires_at: at(9, 0) },
  { id: "acc-li", app_id: "leesidelab", platform: "instagram", handle: "leesidelab", active: true, token_expires_at: at(50, 0) },
  { id: "acc-ly", app_id: "leesidelab", platform: "youtube", handle: "leesidelab", active: true, token_expires_at: null },
];
const img = (path) => ({ path, type: "image/jpeg", alt: "Demo-Bild", width: 1080, height: 1350 });
const posts = [
  { id: "sp1", account_id: "acc-dw", kind: "image", caption: "Abendrunde über dem Birrfeld.\nWer war heute auch in der Luft?\n\n#ppl #flydownwind", first_comment: "#ga #aviation", media: [img("demo/1.jpg")], cover_path: null, status: "draft", scheduled_at: at(2, 16), created_at: at(-1, 9), source: "editor", ai_generated: true, todo: "Am Vortag: Story mit Umfrage-Sticker «Fliegst du am Wochenende?»\nNach dem Posten: @exploring_the_skies auf dem Bild markieren" },
  { id: "sp2", account_id: "acc-dw", kind: "carousel", caption: "5 Dinge, die dein Flugbuch für dich erledigt.", first_comment: "", media: [img("demo/2.jpg"), img("demo/3.jpg")], cover_path: null, status: "approved", scheduled_at: at(1, 17), approved_at: at(-1, 10), created_at: at(-2, 9), source: "package" },
  { id: "sp3", account_id: "acc-dw", kind: "story", caption: "", first_comment: "", media: [{ path: "demo/4.jpg", type: "image/jpeg", width: 1080, height: 1920 }], cover_path: null, status: "failed", scheduled_at: at(-1, 8), attempts: 3, last_error: "Instagram konnte die Datei nicht von Supabase laden.", created_at: at(-3, 9), source: "editor" },
  { id: "sp5", topic: "Föhn", account_id: "acc-ly", kind: "reel", title: "Föhn: why is it 23 °C in Altdorf while Ticino gets rain?", caption: "Part 1 of 3 – how the Alps turn a rainy south wind into warm, dry gusts in the north.\n\n#foehn #aviationweather #pilot", first_comment: "Quick quiz: why is the Föhn wind warmer on the north side than on the south side? 👇", first_comment_reply: "Answer: on the way up the air loses its moisture as rain. Coming down dry, it warms faster than it cooled. That is the whole trick.", first_comment_reply_after_hours: 4, quiz_answer: ["rain", "moisture", "dry"], quiz_correct_replies: ["Spot on 👏", "Exactly, it rains out on the way up 👌"], media: [{ path: "demo/v.mp4", type: "video/mp4", width: 1080, height: 1920, duration: 18 }], cover_path: null, status: "draft", scheduled_at: at(3, 16), created_at: at(-1, 8), source: "package" },
  { id: "sp6", account_id: "acc-li", kind: "reel", caption: "Same air. 8 °C warmer. 🔥 Föhn, part 2/3.\n\n#foehn #aviationweather", first_comment: "", media: [{ path: "demo/v.mp4", type: "video/mp4", width: 1080, height: 1920, duration: 18 }], cover_path: null, status: "approved", scheduled_at: at(4, 16), approved_at: at(-1, 10), created_at: at(-1, 8), source: "package", topic: "Föhn" },
  { id: "sp7", account_id: "acc-li", kind: "reel", caption: "Gotthard, 2007: a PA-28 in föhn turbulence – what the official report says.\n\n#aviationsafety", first_comment: "", media: [{ path: "demo/v.mp4", type: "video/mp4", width: 1080, height: 1920, duration: 18 }], cover_path: null, status: "draft", scheduled_at: at(6, 16), created_at: at(-1, 8), source: "package", topic: "Föhn" },
  { id: "sp8", account_id: "acc-li", kind: "reel", caption: "Why does the air bounce behind a ridge? 🏔️ Mountain waves, part 1/3.", first_comment: "", media: [{ path: "demo/v.mp4", type: "video/mp4", width: 1080, height: 1920, duration: 18 }], cover_path: null, status: "draft", scheduled_at: at(9, 16), created_at: at(-1, 8), source: "package" },
  { id: "sp4", account_id: "acc-dw", kind: "image", caption: "Downwind ist in der Beta. Link in der Bio.", first_comment: "Wie viele Landungen braucht es in 90 Tagen, damit du Passagiere mitnehmen darfst? 👇", first_comment_reply: "Drei Starts und drei Landungen. Downwind zeigt dir, wie lange sie noch gelten.", first_comment_reply_after_hours: 4, first_comment_reply_status: "sent", first_comment_reply_sent_at: at(-4, 21), media: [img("demo/5.jpg")], cover_path: null, status: "published", scheduled_at: at(-4, 17), published_at: at(-4, 17), permalink: "https://www.instagram.com/flydownwind/", created_at: at(-6, 9), source: "editor" },
];

const locations = [{ id: "loc1", page_id: "112233445566", name: "Flugplatz Birrfeld" }, { id: "loc2", page_id: "223344556677", name: "Jungfraujoch" }];
export const load = async () => { await wait(); return { accounts: clone(accounts), posts: clone(posts.filter((p) => p.status !== "cancelled")), locations: clone(locations), comments: clone(demoComments), outreach: await outreach() }; };
export async function stats(days) {
  await wait();
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const accountDays = Array.from({ length: Math.min(days, 28) }, (_, i) => ({ account_id: "acc-dw", day: day(27 - i), metrics: { followers_count: 120 + i * 2 + (i % 3), reach: 80 + (i * 37) % 90, views: 150 + (i * 53) % 160, total_interactions: 12 + (i * 7) % 15, profile_links_taps: i % 4 } }));
  // YouTube channel of Leeside Lab: subscribers, total views, videos
  accountDays.push(...Array.from({ length: Math.min(days, 28) }, (_, i) => ({ account_id: "acc-ly", day: day(27 - i), metrics: { followers_count: 2 + Math.floor(i / 9), views_total: 300 + i * 30, media_count: 2 + Math.floor(i / 14) } })));
  const m = (id, d, kind, caption, metrics, account_id = "acc-dw") => ({ media_id: id, account_id, day: day(0), kind, permalink: "https://www.instagram.com/", caption, posted_at: new Date(Date.now() - d * 864e5).toISOString(), metrics });
  return { accountDays, mediaDays: [
    m("1790001", 3, "CAROUSEL", "Your logbook flies with you now. ✈️", { views: 1480, reach: 920, likes: 64, comments: 9, saved: 31, shares: 12, follows: 6 }),
    m("1790002", 8, "REELS", "Take off. Record. Share.", { views: 3210, reach: 2400, likes: 118, comments: 14, saved: 22, shares: 40, ig_reels_avg_watch_time: 6200 }),
    m("1790003", 12, "FEED", "Fly. 🛩️", { views: 610, reach: 430, likes: 41, comments: 3, saved: 4, shares: 2 }),
    m("yt-nebel-1", 1, "SHORT", "Why is there a sea of fog over Switzerland? | Nebelmeer explained, part 1", { views: 607, likes: 4, comments: 1 }, "acc-ly"),
  ] };
}
export async function addLocation(row) { const l = { id: `loc${locations.length + 1}`, ...row }; locations.push(l); return clone(l); }
export const url = (path) => files.get(path) ?? IMG;
export async function upload(path, file) { files.set(path, URL.createObjectURL(file)); return path; }
export async function copy(from, to) { files.set(to, files.get(from) ?? IMG); return to; }
export async function insert(row) {
  const post = { status: "draft", attempts: 0, created_at: new Date().toISOString(), media: [], ...row };
  posts.unshift(post); emit(); return clone(post);
}
export async function update(id, patch) {
  const p = posts.find((x) => x.id === id);
  // like the database guard: the to-do note and the topic stay editable in every status
  const free = Object.keys(patch).every((k) => k === "todo" || k === "topic");
  if (p.status === "approved" && patch.status === undefined && !free) throw new Error("Freigegebene Beiträge zuerst zurückziehen, dann ändern.");
  Object.assign(p, patch);
  if (patch.status === "approved") Object.assign(p, { approved_at: new Date().toISOString(), attempts: 0, last_error: null });
  emit(); return clone(p);
}
export async function remove(id) { posts.splice(posts.findIndex((p) => p.id === id), 1); emit(); }
export async function publish(id) {
  const p = posts.find((x) => x.id === id);
  Object.assign(p, { status: "publishing" }); emit();
  setTimeout(() => { Object.assign(p, { status: "published", published_at: new Date().toISOString(), permalink: "https://www.instagram.com/flydownwind/", last_error: null }); emit(); }, 1500);
  return [{ id, status: "publishing" }];
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ---------- comment inbox ----------
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const reel = { media_id: "1790011", media_title: "Rain in Ticino, 23 °C in Altdorf. Why? Föhn, part 1", media_permalink: "https://www.instagram.com/leesidelab/" };
const short = { media_id: "dQw4w9WgXcQ", media_title: "Föhn – part 1 (Leeside Lab)", media_permalink: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };
const cm = (id, account_id, media, over) => ({ id, account_id, remote_id: `r-${id}`, parent_remote_id: null, ...media, author: "", author_url: null, body: "", posted_at: ago(30), like_count: 0, own: false, held: false, status: "new", draft: "", replied_at: null, deleted_at: null, ...over });
const demoComments = [
  cm("c1", "acc-li", reel, { author: "pilot_anna", body: "Does this also happen on the north side of the Alps, e.g. in Innsbruck?", posted_at: ago(42), like_count: 3,
    draft: "Yes! Innsbruck gets the same effect when the wind blows from the south – there it's called Südföhn too. 🌬️" }),
  cm("c2", "acc-li", reel, { author: "flyingmarco", body: "Had this on my cross-country last week, crazy turbulence near Altdorf 😅", posted_at: ago(180), status: "done" }),
  cm("c3", "acc-li", reel, { remote_id: "r-c3", parent_remote_id: "r-c2", author: "leesidelab", own: true, body: "@flyingmarco Glad you made it! Rotor turbulence in the lee is no joke.", posted_at: ago(150), status: "done" }),
  cm("c4", "acc-li", reel, { remote_id: "r-c4", parent_remote_id: "r-c2", author: "flyingmarco", body: "@leesidelab What altitude would you recommend to stay out of it?", posted_at: ago(20) }),
  cm("c5", "acc-ly", short, { author: "@WeatherNerd", author_url: "https://www.youtube.com/@WeatherNerd", body: "Great visualisation. Which software do you use for the 3D terrain?", posted_at: ago(75), like_count: 12 }),
  cm("c6", "acc-ly", short, { author: "@crypto-win-4u", body: "Earn $5000 a week from home, message me!!!", posted_at: ago(64), held: true }),
];
export async function comments() { await wait(); return clone(demoComments); }
export async function commentPatch(id, patch) { Object.assign(demoComments.find((c) => c.id === id), patch); emit(); }
export async function fetchComments() { await wait(600); return [{ account: "leesidelab", platform: "instagram", status: "ok", new: 0 }, { account: "leesidelab", platform: "youtube", status: "ok", new: 0 }]; }
export async function reply(id, text) {
  await wait(500);
  const c = demoComments.find((x) => x.id === id);
  const parent = c.parent_remote_id ?? c.remote_id;
  demoComments.push(cm(`c${demoComments.length + 1}`, c.account_id, { media_id: c.media_id, media_title: c.media_title, media_permalink: c.media_permalink },
    { remote_id: `r-new-${demoComments.length}`, parent_remote_id: parent, author: "leesidelab", own: true, body: text, posted_at: new Date().toISOString(), status: "done" }));
  Object.assign(c, { status: "done", draft: "", replied_at: new Date().toISOString() });
  emit();
  return { id, status: "replied" };
}
export async function moderate(id, action) {
  await wait(300);
  const c = demoComments.find((x) => x.id === id);
  if (action === "delete") c.deleted_at = new Date().toISOString();
  else if (action === "hide") c.status = "hidden";
  else if (action === "show") Object.assign(c, { status: "done", held: false });
  else Object.assign(c, { held: false, status: c.status === "hidden" ? "new" : c.status });
  emit();
  return { id, status: action };
}

// ---------- «Bei anderen»: invented creators and suggestions ----------
const out = {
  settings: { enabled: true, daily_limit: 10, monthly_budget_usd: "10.00", model: "claude-sonnet-5-5", rules: "", ig_username: "leesidelab", token_expires_at: new Date(Date.now() + 47 * day).toISOString(), last_run_at: ago(95), last_error: null },
  watch: [
    { id: "w1", kind: "account", value: "alpine.skies.demo", active: true, last_checked_at: ago(95), last_error: null },
    { id: "w2", kind: "account", value: "glider_notes", active: true, last_checked_at: ago(95), last_error: null },
    { id: "w3", kind: "hashtag", value: "föhn", active: true, last_checked_at: ago(95), last_error: null },
    { id: "w4", kind: "hashtag", value: "lenticularclouds", active: false, last_checked_at: null, last_error: null },
  ],
  items: [
    { id: "o1", source: "account", username: "alpine.skies.demo", permalink: "https://www.instagram.com/", caption: "Stacked lenses over the Jungfrau this morning 🤩 #clouds #alps", media_type: "FEED", image_url: null, posted_at: ago(160), like_count: 412, comments_count: 18,
      status: "proposed", draft: "Those stacked lenses mark a standing wave: the air rises and sinks downwind of the ridge, and each layer condenses where it is lifted just enough.", alt_draft: "Lenticulars barely move even in strong wind – the cloud keeps forming at the wave crest and evaporating behind it.", reason: "Linsenwolken über dem Berner Oberland – Welle erklären passt genau.", cost_usd: 0.0081, drafted_at: ago(95), done_at: null },
    { id: "o2", source: "account", username: "glider_notes", permalink: "https://www.instagram.com/", caption: "Fog sea below, sunshine above. Perfect day for the ridge.", media_type: "REELS", image_url: null, posted_at: ago(300), like_count: 88, comments_count: 4,
      status: "proposed", draft: "That fog sea sits under an inversion lid: cold air pooled in the valley, warmer air above stops it from mixing up.", alt_draft: "The flat top of a fog sea shows exactly where the inversion starts – the cloud can't rise into the warmer air above.", reason: "Nebelmeer mit klarer Obergrenze – Inversion als Erklärung.", cost_usd: 0.0076, drafted_at: ago(95), done_at: null },
    { id: "o4", source: "account", username: "segelflug.ch.demo", permalink: "https://www.instagram.com/", caption: "Wellenflug über dem Jura, bis 5200 m! Was für ein Tag.", media_type: "FEED", image_url: null, posted_at: ago(90), like_count: 57, comments_count: 6,
      status: "proposed", draft: "Wahnsinn, 5200 m im Jura! Spannend, wie die stabile Luft hinter dem Kamm so weit hinauf schwingt – hast du Linsenwolken als Wegweiser gesehen?", alt_draft: "Was für ein Wellentag! Die Welle reicht oft viel höher als der Kamm selbst – schön, dass ihr sie so gut erwischt habt.", reason: "Wellenflug über dem Jura – Welle hinter dem Kamm erklären.", cost_usd: 0.0071, drafted_at: ago(80), done_at: null },
    { id: "o3", source: "hashtag", username: "", permalink: "https://www.instagram.com/", caption: "Föhnstimmung in Altdorf, 22 Grad im Oktober!", media_type: "FEED", image_url: null, posted_at: ago(500), like_count: 61, comments_count: 2,
      status: "done", draft: "Föhn warms the air as it sinks down the lee side – about 1 °C per 100 m, which is why Altdorf gets summer days in October.", alt_draft: "", reason: "Föhn in Altdorf – Erwärmung beim Absinken.", cost_usd: 0.0069, drafted_at: ago(1500), done_at: ago(1300) },
  ],
  months: [{ month: "", calls: 34, suggestions: 29, usd: "0.27" }, { month: "", calls: 61, suggestions: 52, usd: "0.48" }],
};
const monthOf = (back) => { const d = new Date(); d.setUTCDate(15); d.setUTCMonth(d.getUTCMonth() - back); return d.toISOString().slice(0, 7); };
out.months[0].month = monthOf(0); out.months[1].month = monthOf(1);
export async function outreach() { await wait(); return clone(out); }
export async function outreachSettings(patch) { Object.assign(out.settings, patch); emit(); }
export async function addWatch(kind, value) {
  if (out.watch.some((w) => w.kind === kind && w.value === value)) throw new Error("Steht schon auf der Liste.");
  out.watch.push({ id: `w${out.watch.length + 1}`, kind, value, active: true, last_checked_at: null, last_error: null }); emit();
}
export async function removeWatch(id) { out.watch.splice(out.watch.findIndex((w) => w.id === id), 1); emit(); }
export async function watchActive(id, active) { out.watch.find((w) => w.id === id).active = active; emit(); }
export async function outreachItem(id, patch) {
  const it = out.items.find((i) => i.id === id);
  Object.assign(it, patch, patch.status ? { done_at: patch.status === "done" ? new Date().toISOString() : null } : {}); emit();
}
export async function runOutreach() { await wait(800); out.settings.last_run_at = new Date().toISOString(); emit(); return { status: out.settings.enabled ? "ok" : "off", found: 0, suggested: 0, skipped: 0, errors: [] }; }
