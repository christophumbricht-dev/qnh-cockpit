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
  { id: "sp1", account_id: "acc-dw", kind: "image", caption: "Abendrunde über dem Birrfeld.\nWer war heute auch in der Luft?\n\n#ppl #flydownwind", first_comment: "#ga #aviation", media: [img("demo/1.jpg")], cover_path: null, status: "draft", scheduled_at: at(2, 16), created_at: at(-1, 9), source: "editor", todo: "Am Vortag: Story mit Umfrage-Sticker «Fliegst du am Wochenende?»\nNach dem Posten: @exploring_the_skies auf dem Bild markieren" },
  { id: "sp2", account_id: "acc-dw", kind: "carousel", caption: "5 Dinge, die dein Flugbuch für dich erledigt.", first_comment: "", media: [img("demo/2.jpg"), img("demo/3.jpg")], cover_path: null, status: "approved", scheduled_at: at(1, 17), approved_at: at(-1, 10), created_at: at(-2, 9), source: "package" },
  { id: "sp3", account_id: "acc-dw", kind: "story", caption: "", first_comment: "", media: [{ path: "demo/4.jpg", type: "image/jpeg", width: 1080, height: 1920 }], cover_path: null, status: "failed", scheduled_at: at(-1, 8), attempts: 3, last_error: "Instagram konnte die Datei nicht von Supabase laden.", created_at: at(-3, 9), source: "editor" },
  { id: "sp4", account_id: "acc-dw", kind: "image", caption: "Downwind ist in der Beta. Link in der Bio.", first_comment: "", media: [img("demo/5.jpg")], cover_path: null, status: "published", scheduled_at: at(-4, 17), published_at: at(-4, 17), permalink: "https://www.instagram.com/flydownwind/", created_at: at(-6, 9), source: "editor" },
];

const locations = [{ id: "loc1", page_id: "112233445566", name: "Flugplatz Birrfeld" }, { id: "loc2", page_id: "223344556677", name: "Jungfraujoch" }];
export const load = async () => { await wait(); return { accounts: clone(accounts), posts: clone(posts.filter((p) => p.status !== "cancelled")), locations: clone(locations), comments: clone(demoComments) }; };
export async function stats(days) {
  await wait();
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const accountDays = Array.from({ length: Math.min(days, 28) }, (_, i) => ({ account_id: "acc-dw", day: day(27 - i), metrics: { followers_count: 120 + i * 2 + (i % 3), reach: 80 + (i * 37) % 90, views: 150 + (i * 53) % 160, total_interactions: 12 + (i * 7) % 15, profile_links_taps: i % 4 } }));
  const m = (id, d, kind, caption, metrics) => ({ media_id: id, account_id: "acc-dw", day: day(0), kind, permalink: "https://www.instagram.com/", caption, posted_at: new Date(Date.now() - d * 864e5).toISOString(), metrics });
  return { accountDays, mediaDays: [
    m("1790001", 3, "CAROUSEL", "Your logbook flies with you now. ✈️", { views: 1480, reach: 920, likes: 64, comments: 9, saved: 31, shares: 12, follows: 6 }),
    m("1790002", 8, "REELS", "Take off. Record. Share.", { views: 3210, reach: 2400, likes: 118, comments: 14, saved: 22, shares: 40, ig_reels_avg_watch_time: 6200 }),
    m("1790003", 12, "FEED", "Fly. 🛩️", { views: 610, reach: 430, likes: 41, comments: 3, saved: 4, shares: 2 }),
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
  if (p.status === "approved" && patch.status === undefined) throw new Error("Freigegebene Beiträge zuerst zurückziehen, dann ändern.");
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
