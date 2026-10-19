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
];
const img = (path) => ({ path, type: "image/jpeg", alt: "Demo-Bild", width: 1080, height: 1350 });
const posts = [
  { id: "sp1", account_id: "acc-dw", kind: "image", caption: "Abendrunde über dem Birrfeld.\nWer war heute auch in der Luft?\n\n#ppl #flydownwind", first_comment: "#ga #aviation", media: [img("demo/1.jpg")], cover_path: null, status: "draft", scheduled_at: at(2, 16), created_at: at(-1, 9), source: "editor", todo: "Am Vortag: Story mit Umfrage-Sticker «Fliegst du am Wochenende?»\nNach dem Posten: @exploring_the_skies auf dem Bild markieren" },
  { id: "sp2", account_id: "acc-dw", kind: "carousel", caption: "5 Dinge, die dein Flugbuch für dich erledigt.", first_comment: "", media: [img("demo/2.jpg"), img("demo/3.jpg")], cover_path: null, status: "approved", scheduled_at: at(1, 17), approved_at: at(-1, 10), created_at: at(-2, 9), source: "package" },
  { id: "sp3", account_id: "acc-dw", kind: "story", caption: "", first_comment: "", media: [{ path: "demo/4.jpg", type: "image/jpeg", width: 1080, height: 1920 }], cover_path: null, status: "failed", scheduled_at: at(-1, 8), attempts: 3, last_error: "Instagram konnte die Datei nicht von Supabase laden.", created_at: at(-3, 9), source: "editor" },
  { id: "sp4", account_id: "acc-dw", kind: "image", caption: "Downwind ist in der Beta. Link in der Bio.", first_comment: "", media: [img("demo/5.jpg")], cover_path: null, status: "published", scheduled_at: at(-4, 17), published_at: at(-4, 17), permalink: "https://www.instagram.com/flydownwind/", created_at: at(-6, 9), source: "editor" },
];

const locations = [{ id: "loc1", page_id: "112233445566", name: "Flugplatz Birrfeld" }, { id: "loc2", page_id: "223344556677", name: "Jungfraujoch" }];
export const load = async () => { await wait(); return { accounts: clone(accounts), posts: clone(posts.filter((p) => p.status !== "cancelled")), locations: clone(locations) }; };
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
