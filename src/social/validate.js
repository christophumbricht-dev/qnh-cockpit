// Checks for social posts before saving / approving – pure functions, unit-tested (tests/social-validate.test.mjs).
// Limits from Meta's Instagram Content Publishing docs (Graph API v25.0) and the Supabase free plan (50 MB per file).

export const LIMITS = {
  caption: 2200,
  firstComment: 2200,
  alt: 1000,
  hashtagsWarn: 15,
  hashtagsMax: 30,
  imageBytes: 8 * 1024 * 1024,
  fileBytes: 50 * 1024 * 1024, // Supabase free plan upload limit
  carousel: [2, 10],
  video: { reel: [3, 900], story: [3, 60], carousel: [3, 60] }, // seconds
  feedRatio: [0.8, 1.91], // 4:5 … 1.91:1
  verticalRatio: 9 / 16,
};

export const KINDS = { image: "Bild", carousel: "Karussell", reel: "Reel", story: "Story" };

// YouTube (Data API v3): title ≤ 100 characters, description ≤ 5000 bytes; more than 60 hashtags → YouTube ignores
// all of them (more than 15 look like spam); vertical videos up to 3 minutes become Shorts. No < > in title or description.
export const YOUTUBE = { title: 100, descriptionBytes: 5000, hashtagsWarn: 15, hashtagsMax: 60, shortMax: 180 };
export const utf8Bytes = (text) => new TextEncoder().encode(String(text ?? "")).length;

const TOL = 0.02;
const near = (a, b, tol = TOL) => Math.abs(a - b) <= b * tol;

export function aspectLabel(width, height) {
  if (!width || !height) return "?";
  const r = width / height;
  for (const [label, value] of [["4:5", 0.8], ["1:1", 1], ["1.91:1", 1.91], ["9:16", 9 / 16], ["16:9", 16 / 9]]) if (near(r, value)) return label;
  return `${r.toFixed(2)}:1`;
}

export function countHashtags(text) {
  return (String(text ?? "").match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
}

const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const isVideo = (item) => /^video\//.test(item.type);

// People tagged on an image (Instagram user_tags): username + position 0..1 (default: bottom centre)
export const TAG_DEFAULT = { x: 0.5, y: 0.9 };
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;
export const cleanUsername = (u) => String(u ?? "").trim().replace(/^@/, "");
export function parseTagList(text, previous = []) {
  // "exploring_the_skies, @someone" → tags; keeps the position of names that were already tagged
  return String(text ?? "").split(/[,\s]+/).map(cleanUsername).filter(Boolean)
    .map((username) => previous.find((t) => t.username === username) ?? { username, ...TAG_DEFAULT });
}

// item: { type, size, width, height, duration? }
export function validateItem(kind, item, index = 0) {
  const errors = [], warnings = [];
  const n = kind === "carousel" ? `Datei ${index + 1}: ` : "";
  const ratio = item.width && item.height ? item.width / item.height : null;
  const vertical = kind === "reel" || kind === "story";

  if (!isVideo(item)) {
    if (item.type !== "image/jpeg") errors.push(`${n}Bilder nur als JPEG (.jpg). Bitte als JPG exportieren.`);
    if (item.size > LIMITS.imageBytes) errors.push(`${n}Bild ist ${mb(item.size)} gross, erlaubt sind höchstens 8 MB.`);
    if (kind === "reel") errors.push("Ein Reel braucht ein Video (MP4).");
    if (ratio && kind === "story" && !near(ratio, LIMITS.verticalRatio)) errors.push(`${n}Story-Bilder im Hochformat 9:16 (dieses: ${aspectLabel(item.width, item.height)}).`);
    if (ratio && !vertical) {
      const [lo, hi] = LIMITS.feedRatio;
      if (ratio < lo * (1 - TOL) || ratio > hi * (1 + TOL)) errors.push(`${n}Seitenverhältnis ${aspectLabel(item.width, item.height)}: erlaubt sind 4:5 bis 1.91:1.`);
      else if (!["4:5", "1:1", "1.91:1"].includes(aspectLabel(item.width, item.height))) warnings.push(`${n}Ungewohntes Format ${aspectLabel(item.width, item.height)} – am besten 4:5, 1:1 oder 1.91:1.`);
    }
    if (item.width && item.width < 320) warnings.push(`${n}Nur ${item.width} px breit – wirkt unscharf (mindestens 1080 px empfohlen).`);
  } else {
    if (!/^video\/(mp4|quicktime)$/.test(item.type)) errors.push(`${n}Videos als MP4 (H.264, AAC) exportieren.`);
    if (kind === "image") errors.push("Für ein Video «Reel» wählen.");
    const [min, max] = LIMITS.video[kind] ?? LIMITS.video.reel;
    if (item.duration != null && (item.duration < min || item.duration > max)) {
      errors.push(`${n}Video ist ${Math.round(item.duration)} s lang, erlaubt sind ${min}–${max >= 120 ? `${max / 60} min` : `${max} s`}.`);
    }
    if (ratio && vertical && !near(ratio, LIMITS.verticalRatio)) errors.push(`${n}Video im Hochformat 9:16 (dieses: ${aspectLabel(item.width, item.height)}).`);
    if (ratio && kind === "carousel") {
      const [lo, hi] = LIMITS.feedRatio;
      if (ratio < lo * (1 - TOL) || ratio > hi * (1 + TOL)) errors.push(`${n}Seitenverhältnis ${aspectLabel(item.width, item.height)}: erlaubt sind 4:5 bis 1.91:1.`);
    }
  }
  const tags = item.user_tags ?? [];
  if (tags.length) {
    if (isVideo(item) || kind === "story" || kind === "reel") errors.push(`${n}Personen markieren geht nur bei Bildern im Feed.`);
    if (tags.length > 20) errors.push(`${n}Höchstens 20 markierte Personen pro Bild.`);
    for (const t of tags) {
      if (!USERNAME.test(t.username ?? "")) errors.push(`${n}«${t.username}» ist kein Instagram-Benutzername.`);
      if (!(t.x >= 0 && t.x <= 1 && t.y >= 0 && t.y <= 1)) errors.push(`${n}Position für @${t.username} muss zwischen 0 und 1 liegen.`);
    }
  }
  if (item.size > LIMITS.fileBytes) errors.push(`${n}Datei ist ${mb(item.size)} gross, höchstens 50 MB (Supabase Gratis-Plan).`);
  if ((item.alt ?? "").length > LIMITS.alt) errors.push(`${n}Alternativtext höchstens ${LIMITS.alt} Zeichen.`);
  return { errors, warnings };
}

// YouTube video: MP4/MOV up to 50 MB (Supabase); vertical up to 3 minutes = Short, anything else a normal video
export function validateYoutubeItem(item) {
  const errors = [], warnings = [];
  if (!isVideo(item)) errors.push("Auf YouTube geht nur ein Video (MP4).");
  else if (!/^video\/(mp4|quicktime)$/.test(item.type)) errors.push("Videos als MP4 (H.264, AAC) exportieren.");
  if (item.size > LIMITS.fileBytes) errors.push(`Datei ist ${mb(item.size)} gross, höchstens 50 MB (Supabase Gratis-Plan).`);
  if (item.duration != null && item.duration < 1) errors.push("Das Video ist leer.");
  const short = (!item.width || item.height >= item.width) && !(item.duration > YOUTUBE.shortMax);
  if (!short) warnings.push(item.duration > YOUTUBE.shortMax ? `Video ist ${Math.round(item.duration)} s lang – länger als 3 Minuten wird es ein normales Video, kein Short.` : "Querformat – wird ein normales YouTube-Video, kein Short.");
  return { errors, warnings };
}

// post: { kind, items, caption, first_comment, platform?, title? }; opts: { forApproval, scheduledAt (ISO), now (Date) }
export function validatePost(post, { forApproval = false, scheduledAt = null, now = new Date() } = {}) {
  const errors = [], warnings = [];
  const items = post.items ?? [];
  const { kind } = post;
  const youtube = post.platform === "youtube";

  if (!KINDS[kind]) errors.push("Art des Beitrags wählen.");
  if (!items.length) errors.push("Mindestens ein Bild oder Video hinzufügen.");
  if (kind === "carousel") {
    const [lo, hi] = LIMITS.carousel;
    if (items.length && (items.length < lo || items.length > hi)) errors.push(`Ein Karussell hat ${lo} bis ${hi} Bilder oder Videos (jetzt ${items.length}).`);
    const first = items[0];
    if (first?.width && items.some((i) => i.width && aspectLabel(i.width, i.height) !== aspectLabel(first.width, first.height))) {
      errors.push("Alle Bilder im Karussell brauchen dasselbe Format – Instagram würde sonst alle auf das Format des ersten zuschneiden.");
    }
  } else if (items.length > 1) {
    errors.push(`${KINDS[kind] ?? "Dieser Beitrag"} hat genau eine Datei – für mehrere «Karussell» wählen.`);
  }
  items.forEach((item, i) => {
    const r = youtube ? validateYoutubeItem(item) : validateItem(kind, item, i);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  });

  const caption = post.caption ?? "";
  const tags = countHashtags(caption);
  if (youtube) {
    if (kind && kind !== "reel") errors.push("Auf YouTube geht nur ein Video – Art «Reel» wählen.");
    const title = String(post.title ?? "").trim();
    if (!title) errors.push("YouTube braucht einen Titel.");
    else if (title.length > YOUTUBE.title) errors.push(`Titel ist ${title.length} Zeichen lang, höchstens ${YOUTUBE.title}.`);
    const bytes = utf8Bytes(caption);
    if (bytes > YOUTUBE.descriptionBytes) errors.push(`Beschreibung ist zu lang (${bytes} Bytes, höchstens ${YOUTUBE.descriptionBytes}).`);
    if (/[<>]/.test(title + caption)) warnings.push("YouTube nimmt < und > nicht an – sie werden weggelassen.");
    const ytTags = tags + countHashtags(title);
    if (ytTags > YOUTUBE.hashtagsMax) errors.push(`${ytTags} Hashtags – bei mehr als ${YOUTUBE.hashtagsMax} ignoriert YouTube alle.`);
    else if (ytTags > YOUTUBE.hashtagsWarn) warnings.push(`${ytTags} Hashtags – mehr als ${YOUTUBE.hashtagsWarn} wirken schnell wie Spam.`);
  } else {
    if (caption.length > LIMITS.caption) errors.push(`Text ist ${caption.length} Zeichen lang, höchstens ${LIMITS.caption}.`);
    if (tags > LIMITS.hashtagsMax) errors.push(`${tags} Hashtags – Instagram erlaubt höchstens ${LIMITS.hashtagsMax}.`);
    else if (tags > LIMITS.hashtagsWarn) warnings.push(`${tags} Hashtags – mehr als ${LIMITS.hashtagsWarn} wirken schnell wie Spam.`);
  }
  const comment = post.first_comment ?? "";
  if (comment.length > LIMITS.firstComment) errors.push(`Erster Kommentar höchstens ${LIMITS.firstComment} Zeichen.`);
  if (countHashtags(comment) > LIMITS.hashtagsMax) errors.push(`Erster Kommentar: höchstens ${LIMITS.hashtagsMax} Hashtags.`);
  if (kind === "story" && (caption.trim() || comment.trim())) warnings.push("Stories zeigen keinen Text und keinen Kommentar – beides wird ignoriert.");

  if (forApproval) {
    if (!scheduledAt) errors.push("Zum Freigeben einen Zeitpunkt wählen.");
    else if (new Date(scheduledAt).getTime() < now.getTime() - 5 * 60_000) errors.push("Der Zeitpunkt liegt in der Vergangenheit.");
  }
  return { errors, warnings };
}

// ---------- time: the cockpit always shows Swiss time (Europe/Zurich), the database stores UTC ----------

const TZ = "Europe/Zurich";
const PARTS = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function zurichParts(date) {
  const p = Object.fromEntries(PARTS.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}
const offsetMs = (date) => {
  const p = zurichParts(date);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
};

// "2026-10-25T18:30" (Swiss wall clock, as from <input type=datetime-local>) → ISO in UTC
export function zurichToUtc(local) {
  const m = String(local ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = wall - offsetMs(new Date(wall));
  t = wall - offsetMs(new Date(t)); // second pass gets the DST switch days right
  return new Date(t).toISOString();
}

// ISO (UTC) → "2026-10-25T18:30" for <input type=datetime-local>
export function utcToZurichLocal(iso) {
  if (!iso) return "";
  const p = zurichParts(new Date(iso));
  const z = (n) => String(n).padStart(2, "0");
  return `${p.y}-${z(p.mo)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

const DISPLAY = new Intl.DateTimeFormat("de-CH", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const formatZurich = (iso) => (iso ? DISPLAY.format(new Date(iso)) : "");
const DATE = new Intl.DateTimeFormat("de-CH", { timeZone: TZ, day: "numeric", month: "numeric", year: "numeric" });
export const formatZurichDate = (iso) => (iso ? DATE.format(new Date(iso)) : "");
