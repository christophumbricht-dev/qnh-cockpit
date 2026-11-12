// What fills the Social file store, and tidy it (Supabase free plan: 1 GB for all buckets; Christoph 12.11.2026).
//   npm run social -- speicher                          report only, changes nothing
//   npm run social -- speicher --aufraeumen [--tage 3]  delete what is no longer needed
// Deleted are: files no post and no studio row names any more (older than 2 days), videos of cancelled posts,
// and videos of posts published more than --tage days ago (cover and still stay, so the lists keep a picture).
// Never touched: anything a draft, an approved, a publishing or a failed post names.
const BUCKET = "social-media";
const VIDEO = /\.(mp4|mov)$/i;
const DAY = 86400_000;
const KEEP = new Set(["draft", "approved", "publishing", "failed"]);

// a path counts as named when a stored string ends with it (plain path or public URL)
// pure: files [{ path, size, created_at }], posts [{ id, status, published_at, json }], studio = one string of all studio rows
export function classify(files, posts, studio, now, keepDays = 3) {
  return files.map((f) => {
    const users = posts.filter((p) => p.json.includes(`${f.path}"`));
    const inStudio = studio.includes(`${f.path}"`);
    let kind;
    if (users.some((p) => KEEP.has(p.status))) kind = "aktiv";
    else if (users.length) {
      const old = users.every((p) => p.status === "cancelled" || (p.status === "published" && p.published_at && now - new Date(p.published_at).getTime() > keepDays * DAY));
      kind = !old ? "frisch" : !VIDEO.test(f.path) ? "bild" : users.every((p) => p.status === "cancelled") ? "abgebrochen" : "alt";
    } else if (inStudio) kind = "studio";
    else kind = now - new Date(f.created_at ?? 0).getTime() > 2 * DAY ? "verwaist" : "neu";
    return { ...f, kind };
  });
}
export const DELETABLE = new Set(["verwaist", "abgebrochen", "alt"]);
const LABEL = {
  aktiv: "Entwürfe und geplante Beiträge (bleiben)", frisch: "kürzlich veröffentlicht (bleiben noch)", bild: "Titelbilder und Standbilder alter Beiträge (bleiben)",
  studio: "nur vom Studio gebraucht (bleiben)", neu: "neu und noch ohne Beitrag (bleiben)",
  alt: "Videos alter veröffentlichter Beiträge (löschbar)", abgebrochen: "Videos abgebrochener Beiträge (löschbar)", verwaist: "gehören zu keinem Beitrag mehr (löschbar)",
};
const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;

async function listAll(sb, prefix = "") {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`Speicher lesen: ${error.message}`);
    for (const e of data) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) out.push(...(await listAll(sb, path)));
      else out.push({ path, size: e.metadata?.size ?? 0, created_at: e.created_at });
    }
    if (data.length < 1000) return out;
  }
}
async function allRows(sb, table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("*").range(from, from + 999);
    if (error) { if (table !== "social_posts") return rows; throw new Error(`${table}: ${error.message}`); } // studio tables may be missing
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export async function storage(sb, opt) {
  const keepDays = Number(opt.tage ?? 3);
  if (!(keepDays >= 1)) throw new Error("--tage braucht eine Zahl ab 1.");
  const files = await listAll(sb);
  const posts = (await allRows(sb, "social_posts")).map((p) => ({ id: p.id, status: p.status, published_at: p.published_at, json: JSON.stringify(p) }));
  const studio = JSON.stringify([await allRows(sb, "studio_items"), await allRows(sb, "studio_versions")]);
  const rows = classify(files, posts, studio, Date.now(), keepDays);
  const total = rows.reduce((s, f) => s + f.size, 0);
  console.log(`Social-Speicher: ${rows.length} Dateien, ${mb(total)}`);
  for (const kind of Object.keys(LABEL)) {
    const part = rows.filter((f) => f.kind === kind);
    if (part.length) console.log(`  ${mb(part.reduce((s, f) => s + f.size, 0)).padStart(8)}  ${String(part.length).padStart(4)} Dateien  ${LABEL[kind]}`);
  }
  const gone = rows.filter((f) => DELETABLE.has(f.kind));
  const sum = gone.reduce((s, f) => s + f.size, 0);
  if (!gone.length) return console.log("Nichts zu löschen.");
  if (!opt.aufraeumen) return console.log(`Löschbar: ${gone.length} Dateien, ${mb(sum)}. Ausführen mit: npm run social -- speicher --aufraeumen`);
  for (let i = 0; i < gone.length; i += 100) {
    const { error } = await sb.storage.from(BUCKET).remove(gone.slice(i, i + 100).map((f) => f.path));
    if (error) throw new Error(`Löschen: ${error.message}`);
  }
  console.log(`Gelöscht: ${gone.length} Dateien, ${mb(sum)}. Bleibt: ${mb(total - sum)}. Supabase zeigt den neuen Stand nach etwa einer Stunde.`);
}
