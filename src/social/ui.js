// Cockpit tab "Social": post queue per app, editor with checks and phone preview, approval.
// Nothing is ever approved automatically – only the "Freigeben" button (and the database checks that too).
import { esc, num } from "../format.js";
import * as data from "./data.js";
import { KINDS, LIMITS, aspectLabel, countHashtags, formatZurich, formatZurichDate, utcToZurichLocal, validatePost, zurichToUtc } from "./validate.js";
import { readPackage } from "./package.js";

const STATUS = { draft: "Entwurf", approved: "Geplant", publishing: "Wird veröffentlicht …", published: "Veröffentlicht", failed: "Fehler" };
const GROUPS = [["Entwürfe", ["draft"]], ["Geplant", ["approved", "publishing"]], ["Veröffentlicht", ["published"]], ["Fehler", ["failed"]]];
const PLATFORM = { instagram: "Instagram", facebook: "Facebook" };
const LOCKED = ["approved", "publishing", "published"];

export function createSocial({ S, render, toast, errorText, appName }) {
  S.social = { value: null, loading: false, error: null, filter: "all", editor: null };
  let unsubscribe = null;
  let reloadTimer;

  // ---------- data ----------
  async function load(force = false) {
    const st = S.social;
    if (!data.socialConfigured() || st.loading || (st.value && !force)) return;
    st.loading = true;
    try {
      st.value = await data.loadSocial();
      st.error = null;
      if (!unsubscribe) unsubscribe = data.subscribe(() => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => load(true), 300); });
    } catch (err) {
      st.error = err;
    }
    st.loading = false;
    if (!S.social.editor || !document.activeElement?.closest?.(".soc-editor")) render();
  }

  const accounts = () => S.social.value?.accounts ?? [];
  const posts = () => S.social.value?.posts ?? [];
  const account = (id) => accounts().find((a) => a.id === id);
  const accountLabel = (a) => (a ? `${appName(a.app_id)} · ${PLATFORM[a.platform] ?? a.platform} @${a.handle}` : "Unbekanntes Konto");
  const daysLeft = (iso) => (iso ? Math.floor((new Date(iso) - Date.now()) / 864e5) : null);
  const firstLines = (text, n = 3) => String(text ?? "").split("\n").filter(Boolean).slice(0, n).join("\n");

  // ---------- overview card + badge ----------
  function overviewCard() {
    if (!data.socialConfigured()) return "";
    const st = S.social;
    if (!st.value) return `<section class="card"><div class="card-head"><span class="dot dot-social"></span><div><h2>Social</h2><p class="muted">Beiträge aller Apps</p></div></div>${st.error ? `<p class="error">${esc(errorText(st.error))}</p>` : `<p class="muted loading">Lädt …</p>`}</section>`;
    const planned = posts().filter((p) => p.status === "approved").sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    const failed = posts().filter((p) => p.status === "failed").length;
    const drafts = posts().filter((p) => p.status === "draft").length;
    const expiring = accounts().filter((a) => a.active && daysLeft(a.token_expires_at) !== null && daysLeft(a.token_expires_at) < 14);
    const tile = (label, value, sub, alert) => `<a class="tile${alert ? " alert" : ""}" href="#social"><span class="tile-label">${label}</span><span class="tile-num">${value}</span>${sub ? `<span class="tile-sub">${esc(sub)}</span>` : ""}</a>`;
    return `<section class="card"><div class="card-head"><span class="dot dot-social"></span><div><h2>Social</h2><p class="muted">Beiträge aller Apps</p></div></div>
      <div class="tiles">
        ${tile("Geplant", num(planned.length), planned[0] ? `nächster: ${formatZurich(planned[0].scheduled_at)}` : "", false)}
        ${tile("Entwürfe", num(drafts), "", false)}
        ${tile("Fehler", num(failed), "", failed > 0)}
        ${expiring.length ? tile("Token läuft ab", num(expiring.length), expiring.map((a) => `@${a.handle}: ${daysLeft(a.token_expires_at)} Tage`).join(", "), true) : ""}
      </div></section>`;
  }
  const badge = () => posts().filter((p) => p.status === "failed").length;

  // ---------- list ----------
  function view() {
    if (!data.socialConfigured()) {
      return `<section class="card"><h2>Social</h2><p class="note">QNH Core ist noch nicht eingerichtet. Anleitung: <code>docs/social-setup.md</code>.</p></section>`;
    }
    const st = S.social;
    if (st.editor) return editorView(st.editor);
    if (!st.value) return st.error ? `<p class="error">${esc(errorText(st.error))}</p>` : `<p class="muted loading">Lädt …</p>`;
    const apps = [...new Set(accounts().map((a) => a.app_id))];
    const shown = posts().filter((p) => st.filter === "all" || account(p.account_id)?.app_id === st.filter);
    const chips = [["all", "Alle Apps"], ...apps.map((id) => [id, appName(id)])]
      .map(([v, l]) => `<button class="chip${st.filter === v ? " on" : ""}" data-action="soc-filter" data-value="${esc(v)}">${esc(l)}</button>`).join("");
    const accountRows = accounts().map((a) => {
      const left = daysLeft(a.token_expires_at);
      const token = left === null ? "Token: Ablauf unbekannt" : left < 0 ? "Token abgelaufen" : `Token gültig bis ${formatZurichDate(a.token_expires_at)}`;
      return `<li><b>${esc(accountLabel(a))}</b>${a.active ? "" : " (inaktiv)"} <span class="${left !== null && left < 14 ? "warn" : "muted"}">· ${esc(token)}</span></li>`;
    }).join("");
    return `<div class="toolbar"><div class="chips">${chips}</div>
        <div class="row-right">
          <label class="btn ghost file-btn">Paket importieren<input type="file" name="soc-package" accept=".zip,application/zip,.json,image/jpeg,video/mp4" multiple hidden></label>
          <button class="btn" data-action="soc-new"${accounts().length ? "" : " disabled"}>Neuer Beitrag</button>
        </div></div>
      ${accounts().length ? `<ul class="accounts">${accountRows}</ul>` : `<p class="note">Noch kein Konto verbunden (docs/social-setup.md, Schritt «Konto eintragen»).</p>`}
      ${st.error ? `<p class="error">${esc(errorText(st.error))}</p>` : ""}
      ${GROUPS.map(([title, statuses]) => {
        const rows = shown.filter((p) => statuses.includes(p.status))
          .sort((a, b) => (title === "Geplant" ? (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "") : (b.published_at ?? b.created_at ?? "").localeCompare(a.published_at ?? a.created_at ?? "")));
        return `<h3 class="group">${title} <span class="muted">${rows.length}</span></h3>${rows.length ? rows.map(postItem).join("") : `<p class="muted small">–</p>`}`;
      }).join("")}`;
  }

  function thumb(item, cls = "thumb") {
    if (!item) return `<span class="${cls} empty"></span>`;
    const src = item.url ?? data.mediaUrl(item.path);
    return /^video\//.test(item.type)
      ? `<video class="${cls}" src="${esc(src)}" muted playsinline preload="metadata"></video>`
      : `<img class="${cls}" src="${esc(src)}" alt="${esc(item.alt ?? "")}" loading="lazy">`;
  }

  function postItem(p) {
    const a = account(p.account_id);
    const when = p.status === "published" ? p.published_at : p.scheduled_at;
    const btn = (action, label, ghost = true) => `<button class="btn${ghost ? " ghost" : ""}" data-action="${action}" data-id="${p.id}">${label}</button>`;
    const actions = [];
    if (p.status === "draft" || p.status === "failed") actions.push(btn("soc-open", "Bearbeiten", false));
    else actions.push(btn("soc-open", "Ansehen"));
    if (p.status === "approved") actions.push(btn("soc-withdraw", "Zurückziehen"));
    if (["draft", "approved", "failed"].includes(p.status)) actions.push(btn("soc-publish-now", "Jetzt veröffentlichen"));
    actions.push(btn("soc-duplicate", "Duplizieren"));
    if (p.permalink) actions.push(`<a class="btn ghost" href="${esc(p.permalink)}" target="_blank" rel="noopener">Auf ${PLATFORM[a?.platform] ?? "Instagram"} öffnen</a>`);
    if (p.status === "draft") actions.push(btn("soc-delete", "Löschen"));
    return `<article class="item soc-item">
      ${p.media_deleted_at ? `<span class="thumb empty"></span>` : thumb(p.media?.[0])}
      <div>
        <div class="meta"><b>${esc(accountLabel(a))}</b><span>${KINDS[p.kind] ?? p.kind}${p.media?.length > 1 ? ` · ${p.media.length} Dateien` : ""}</span>
          <span>${when ? esc(formatZurich(when)) : "kein Zeitpunkt"}</span><span class="pill ${p.status}">${STATUS[p.status] ?? p.status}</span>
          ${p.source === "package" ? `<span class="muted">aus Paket</span>` : ""}</div>
        <p class="text">${esc(firstLines(p.caption, 2) || (p.kind === "story" ? "(Story ohne Text)" : "(kein Text)"))}</p>
        ${p.last_error ? `<p class="error small">${esc(p.last_error)}</p>` : ""}
        <div class="actions">${actions.join("")}</div>
      </div>
    </article>`;
  }

  // ---------- editor ----------
  function tomorrowAt18() {
    const local = utcToZurichLocal(new Date(Date.now() + 864e5).toISOString());
    return `${local.slice(0, 10)}T18:00`;
  }

  function openEditor(post, { duplicate = false } = {}) {
    const fallback = accounts().find((a) => S.social.filter === "all" || a.app_id === S.social.filter) ?? accounts()[0];
    const items = (post?.media ?? []).map((m) => (duplicate ? { ...m, copyFrom: m.path, path: null } : { ...m }));
    S.social.editor = {
      id: post && !duplicate ? post.id : crypto.randomUUID(),
      isNew: !post || duplicate,
      status: post && !duplicate ? post.status : "draft",
      account_id: post?.account_id ?? fallback?.id,
      kind: post?.kind ?? "image",
      caption: post?.caption ?? "",
      first_comment: post?.first_comment ?? "",
      scheduledLocal: post?.scheduled_at ? utcToZurichLocal(post.scheduled_at) : tomorrowAt18(),
      items,
      cover: post?.cover_path ? (duplicate ? { copyFrom: post.cover_path, type: "image/jpeg" } : { path: post.cover_path, type: "image/jpeg" }) : null,
      source: duplicate ? "duplicate" : post?.source ?? "editor",
      permalink: duplicate ? null : post?.permalink,
      last_error: duplicate ? null : post?.last_error,
      mediaDeleted: !duplicate && !!post?.media_deleted_at,
      dirty: duplicate,
      busy: false,
      preview: 0,
    };
    render();
    window.scrollTo(0, 0);
  }

  const readonly = (ed) => !ed.isNew && LOCKED.includes(ed.status);
  const checks = (ed, forApproval = false) =>
    validatePost({ kind: ed.kind, items: ed.items, caption: ed.caption, first_comment: ed.first_comment },
      { forApproval, scheduledAt: zurichToUtc(ed.scheduledLocal) });

  function checksHtml(ed) {
    const { errors, warnings } = checks(ed);
    if (!errors.length && !warnings.length) return `<p class="ok small">Alles in Ordnung.</p>`;
    return `${errors.map((e) => `<p class="error small">✗ ${esc(e)}</p>`).join("")}${warnings.map((w) => `<p class="warn small">! ${esc(w)}</p>`).join("")}`;
  }

  function counterHtml(ed) {
    const tags = countHashtags(ed.caption);
    const cls = ed.caption.length > LIMITS.caption || tags > LIMITS.hashtagsMax ? "error" : tags > LIMITS.hashtagsWarn ? "warn" : "muted";
    return `<span class="${cls}">${ed.caption.length} / ${LIMITS.caption} Zeichen · ${tags} Hashtag${tags === 1 ? "" : "s"}</span>`;
  }

  function editorView(ed) {
    const ro = readonly(ed);
    const dis = ro || ed.busy ? " disabled" : "";
    const acc = account(ed.account_id);
    const kinds = Object.entries(KINDS).map(([k, l]) =>
      `<button class="chip${ed.kind === k ? " on" : ""}" data-action="soc-kind" data-value="${k}"${dis}>${l}</button>`).join("");
    const accept = ed.kind === "image" ? ".jpg,.jpeg,image/jpeg" : ed.kind === "reel" ? "video/mp4,video/quicktime" : ".jpg,.jpeg,image/jpeg,video/mp4,video/quicktime";
    const itemsHtml = ed.items.map((it, i) => `<li class="soc-file">
        ${thumb({ ...it, url: it.url ?? (it.path ? data.mediaUrl(it.path) : it.copyFrom ? data.mediaUrl(it.copyFrom) : undefined) }, "thumb small")}
        <div><span class="small muted">${/^video\//.test(it.type) ? "Video" : "Bild"} · ${aspectLabel(it.width, it.height)}${it.width ? ` · ${it.width}×${it.height}` : ""}${it.duration ? ` · ${Math.round(it.duration)} s` : ""}${it.size ? ` · ${(it.size / 1048576).toFixed(1)} MB` : ""}</span>
          ${/^video\//.test(it.type) ? "" : `<input name="soc-alt-${i}" placeholder="Alternativtext (für Screenreader)" value="${esc(it.alt ?? "")}" maxlength="${LIMITS.alt}"${dis}>`}</div>
        ${ro ? "" : `<button class="link" data-action="soc-remove" data-value="${i}">Entfernen</button>`}
      </li>`).join("");
    const actions = [];
    if (!ro) {
      actions.push(`<button class="btn ghost" data-action="soc-save"${dis}>Speichern (Entwurf)</button>`);
      actions.push(`<button class="btn" data-action="soc-approve"${dis}>Freigeben …</button>`);
    }
    if (!ed.isNew && ed.status === "approved") actions.push(`<button class="btn ghost" data-action="soc-withdraw" data-id="${ed.id}"${ed.busy ? " disabled" : ""}>Zurückziehen</button>`);
    if (["draft", "approved", "failed"].includes(ed.status)) actions.push(`<button class="btn ghost" data-action="soc-publish-now" data-id="${ed.id}"${ed.busy ? " disabled" : ""}>Jetzt veröffentlichen …</button>`);
    if (!ed.isNew) actions.push(`<button class="btn ghost" data-action="soc-duplicate" data-id="${ed.id}">Duplizieren</button>`);
    if (ed.permalink) actions.push(`<a class="btn ghost" href="${esc(ed.permalink)}" target="_blank" rel="noopener">Auf Instagram öffnen</a>`);

    return `<div class="toolbar"><button class="link" data-action="soc-close">← Zurück zur Liste</button>
        <span class="muted">${ed.isNew ? (ed.source === "duplicate" ? "Duplikat" : "Neuer Beitrag") : `${STATUS[ed.status] ?? ed.status}`}${ro ? " · zum Ändern zuerst zurückziehen oder duplizieren" : ""}</span></div>
      <section class="soc-editor">
        <div class="soc-form card">
          ${ed.last_error ? `<p class="error">${esc(ed.last_error)}</p>` : ""}
          <label class="field">Konto
            <select name="soc-account"${dis}>${accounts().map((a) => `<option value="${a.id}"${a.id === ed.account_id ? " selected" : ""}>${esc(accountLabel(a))}</option>`).join("")}</select></label>
          <div class="field">Art<div class="chips">${kinds}</div></div>
          ${ed.mediaDeleted ? `<p class="note">Die Dateien wurden 14 Tage nach der Veröffentlichung gelöscht.</p>` : ""}
          ${ro ? "" : `<label class="dropzone" data-drop="files">
              <input type="file" name="soc-files" accept="${accept}" ${ed.kind === "carousel" ? "multiple" : ""} hidden>
              <b>${ed.kind === "carousel" ? "Bilder oder Videos" : ed.kind === "reel" ? "Video" : ed.kind === "story" ? "Bild oder Video" : "Bild"} hierher ziehen</b> oder klicken
              <span class="small muted">${ed.kind === "reel" || ed.kind === "story" ? "Hochformat 9:16" : "JPEG, 4:5 / 1:1 / 1.91:1"} · Videos als MP4 (H.264)</span></label>`}
          <ul class="soc-files">${itemsHtml}</ul>
          ${ed.kind === "reel" ? `<div class="field">Titelbild (optional, JPEG)
            ${ed.cover ? `<div class="soc-file">${thumb({ ...ed.cover, url: ed.cover.url ?? data.mediaUrl(ed.cover.path ?? ed.cover.copyFrom) }, "thumb small")}${ro ? "" : `<button class="link" data-action="soc-remove-cover">Entfernen</button>`}</div>`
              : ro ? `<span class="muted small">keines</span>` : `<input type="file" name="soc-cover" accept=".jpg,.jpeg,image/jpeg">`}</div>` : ""}
          ${ed.kind === "story" ? "" : `<label class="field">Text <span class="counter" id="soc-counter">${counterHtml(ed)}</span>
            <textarea name="soc-caption" rows="7" maxlength="2400"${dis}>${esc(ed.caption)}</textarea></label>
          <label class="field">Erster Kommentar (optional, z. B. Hashtags)
            <textarea name="soc-comment" rows="2" maxlength="2400"${dis}>${esc(ed.first_comment)}</textarea></label>`}
          <label class="field">Veröffentlichen am (Schweizer Zeit)
            <input type="datetime-local" name="soc-time" value="${esc(ed.scheduledLocal)}"${dis}></label>
          <div id="soc-checks" class="soc-checks">${checksHtml(ed)}</div>
          <div class="actions">${actions.join("")}</div>
        </div>
        <aside class="soc-preview" id="soc-preview">${previewHtml(ed, acc)}</aside>
      </section>`;
  }

  function previewHtml(ed, acc) {
    const handle = acc?.handle ?? "konto";
    const it = ed.items[Math.min(ed.preview, ed.items.length - 1)];
    const media = it ? thumb({ ...it, url: it.url ?? (it.path ? data.mediaUrl(it.path) : it.copyFrom ? data.mediaUrl(it.copyFrom) : undefined) }, "phone-img") : `<span class="phone-img empty">Noch keine Datei</span>`;
    const vertical = ed.kind === "story" || ed.kind === "reel";
    const ratio = vertical ? "9 / 16" : it?.width ? `${it.width} / ${it.height}` : "4 / 5";
    const dots = ed.kind === "carousel" && ed.items.length > 1
      ? `<div class="phone-dots">${ed.items.map((_, i) => `<button class="${i === ed.preview ? "on" : ""}" data-action="soc-preview" data-value="${i}" aria-label="Datei ${i + 1}"></button>`).join("")}</div>` : "";
    const cap = ed.caption.length > 125 ? `${esc(ed.caption.slice(0, 125))}… <span class="muted">mehr</span>` : esc(ed.caption);
    return `<div class="phone${vertical ? " vertical" : ""}">
      <div class="phone-head"><span class="avatar"></span><b>${esc(handle)}</b>${ed.kind === "story" ? `<span class="muted small">Story</span>` : ""}</div>
      <div class="phone-media" style="aspect-ratio:${ratio}">${media}</div>
      ${dots}
      ${vertical ? "" : `<div class="phone-caption"><b>${esc(handle)}</b> ${cap}</div>${ed.first_comment.trim() ? `<div class="phone-comment"><b>${esc(handle)}</b> ${esc(ed.first_comment.slice(0, 80))}</div>` : ""}`}
    </div>
    <p class="small muted">Vorschau, ungefähr wie auf dem iPhone. Instagram schneidet Feed-Bilder auf 4:5 bis 1.91:1 zu.</p>`;
  }

  function refreshBits() {
    const ed = S.social.editor;
    if (!ed) return;
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    set("soc-counter", counterHtml(ed));
    set("soc-checks", checksHtml(ed));
    set("soc-preview", previewHtml(ed, account(ed.account_id)));
  }

  async function probe(file) {
    const url = URL.createObjectURL(file);
    const base = { file, url, type: file.type || guessType(file.name), size: file.size, alt: "" };
    if (/^video\//.test(base.type)) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.src = url;
      await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 8000); });
      return { ...base, width: v.videoWidth || undefined, height: v.videoHeight || undefined, duration: Number.isFinite(v.duration) ? v.duration : undefined };
    }
    try {
      const bmp = await createImageBitmap(file);
      const r = { ...base, width: bmp.width, height: bmp.height };
      bmp.close();
      return r;
    } catch {
      return base;
    }
  }
  const guessType = (name) => (/\.jpe?g$/i.test(name) ? "image/jpeg" : /\.mp4$/i.test(name) ? "video/mp4" : /\.mov$/i.test(name) ? "video/quicktime" : "");

  async function addFiles(fileList) {
    const ed = S.social.editor;
    if (!ed || readonly(ed)) return;
    const added = await Promise.all([...fileList].map(probe));
    ed.items = ed.kind === "carousel" ? [...ed.items, ...added].slice(0, 12) : added.slice(0, 1);
    ed.preview = 0;
    ed.dirty = true;
    render();
  }

  // uploads new files / copies for duplicates, then inserts or updates the post (always as it is: draft/failed)
  async function persist(ed) {
    const media = [];
    for (const [i, it] of ed.items.entries()) {
      let path = it.path;
      if (it.file) path = await data.uploadFile(ed.id, it.file, i);
      else if (it.copyFrom) path = await data.copyFile(it.copyFrom, ed.id, it.type, i);
      media.push({ path, type: it.type, alt: it.alt ?? "", width: it.width ?? null, height: it.height ?? null, duration: it.duration ?? null });
      Object.assign(it, { path, file: undefined, copyFrom: undefined });
    }
    let cover_path = null;
    if (ed.kind === "reel" && ed.cover) {
      cover_path = ed.cover.path;
      if (ed.cover.file) cover_path = await data.uploadFile(ed.id, ed.cover.file, "cover");
      else if (ed.cover.copyFrom) cover_path = await data.copyFile(ed.cover.copyFrom, ed.id, "image/jpeg", "cover");
      Object.assign(ed.cover, { path: cover_path, file: undefined, copyFrom: undefined });
    }
    const row = {
      account_id: ed.account_id, kind: ed.kind, caption: ed.kind === "story" ? "" : ed.caption,
      first_comment: ed.kind === "story" ? "" : ed.first_comment, media, cover_path,
      scheduled_at: zurichToUtc(ed.scheduledLocal), source: ed.source,
    };
    const saved = ed.isNew ? await data.insertPost(ed.id, row) : await data.updatePost(ed.id, row);
    ed.isNew = false;
    ed.dirty = false;
    ed.status = saved?.status ?? ed.status;
    return saved;
  }

  function confirmText(title, ed) {
    const acc = account(ed.account_id);
    const lines = firstLines(ed.caption) || (ed.kind === "story" ? "(Story)" : "(kein Text)");
    return `${title}\n\nKonto: ${accountLabel(acc)}\nArt: ${KINDS[ed.kind]}\nZeit: ${formatZurich(zurichToUtc(ed.scheduledLocal))}\n\n${lines}`;
  }

  async function busy(ed, fn) {
    ed.busy = true;
    render();
    try {
      await fn();
    } catch (err) {
      toast(errorText(err));
    }
    ed.busy = false;
    if (S.social.editor === ed) render();
  }

  const editorFor = (id) => {
    const ed = S.social.editor;
    if (ed && ed.id === id) return ed;
    const p = posts().find((x) => x.id === id);
    return p ? { id: p.id, isNew: false, status: p.status, account_id: p.account_id, kind: p.kind, caption: p.caption, first_comment: p.first_comment, scheduledLocal: utcToZurichLocal(p.scheduled_at), items: p.media, busy: false } : null;
  };

  async function publishNow(id) {
    const ed = editorFor(id);
    if (!ed) return;
    const now = new Date().toISOString();
    if (!ed.isNew || S.social.editor?.id === id) {
      const { errors } = checks({ ...ed, scheduledLocal: utcToZurichLocal(now) }, true);
      if (errors.length) return toast(errors[0]);
    }
    if (!confirm(confirmText("Jetzt veröffentlichen? Der Beitrag geht sofort online.", { ...ed, scheduledLocal: utcToZurichLocal(now) }))) return;
    await busy(ed, async () => {
      if (S.social.editor?.id === id && (ed.dirty || ed.isNew)) await persist(ed);
      if (ed.status === "approved") await data.setStatus(id, "draft");
      await data.setStatus(id, "approved", now);
      ed.status = "approved";
      toast("Wird veröffentlicht …");
      const results = await data.publishNow(id);
      const r = results.find((x) => x.id === id);
      if (r?.error) toast(r.error);
      else if (r?.status === "published") toast("Veröffentlicht");
      else if (r?.status === "processing") toast("Instagram verarbeitet das Video noch – der Status aktualisiert sich von selbst.");
      await load(true);
      if (S.social.editor?.id === id) S.social.editor.status = posts().find((p) => p.id === id)?.status ?? ed.status;
    });
  }

  // ---------- events (called from main.js) ----------
  async function onClick(action, el) {
    const st = S.social;
    const ed = st.editor;
    const id = el.dataset.id;
    switch (action) {
      case "soc-filter": st.filter = el.dataset.value; render(); return true;
      case "soc-new": openEditor(null); return true;
      case "soc-open": openEditor(posts().find((p) => p.id === id)); return true;
      case "soc-duplicate": openEditor(posts().find((p) => p.id === id) ?? (ed && { ...ed, media: ed.items, scheduled_at: zurichToUtc(ed.scheduledLocal), cover_path: ed.cover?.path }), { duplicate: true }); return true;
      case "soc-close":
        if (ed?.dirty && !confirm("Änderungen verwerfen?")) return true;
        st.editor = null; render(); load(true); return true;
      case "soc-kind":
        if (ed && !readonly(ed)) { ed.kind = el.dataset.value; if (ed.kind !== "carousel") ed.items = ed.items.slice(0, 1); ed.dirty = true; render(); }
        return true;
      case "soc-remove": ed.items.splice(Number(el.dataset.value), 1); ed.preview = 0; ed.dirty = true; render(); return true;
      case "soc-remove-cover": ed.cover = null; ed.dirty = true; render(); return true;
      case "soc-preview": ed.preview = Number(el.dataset.value); refreshBits(); return true;
      case "soc-save": {
        const { errors } = checks(ed);
        if (errors.length) { toast(`Noch nicht speicherbar: ${errors[0]}`); return true; }
        await busy(ed, async () => { await persist(ed); toast("Entwurf gespeichert"); await load(true); });
        return true;
      }
      case "soc-approve": {
        const { errors } = checks(ed, true);
        if (errors.length) { toast(errors[0]); refreshBits(); return true; }
        if (!confirm(confirmText("Diesen Beitrag freigeben? Er wird zur geplanten Zeit automatisch veröffentlicht.", ed))) return true;
        await busy(ed, async () => {
          await persist(ed);
          await data.setStatus(ed.id, "approved", zurichToUtc(ed.scheduledLocal));
          toast("Freigegeben");
          st.editor = null;
          await load(true);
        });
        render();
        return true;
      }
      case "soc-withdraw":
        if (!confirm("Freigabe zurückziehen? Der Beitrag wird wieder ein Entwurf und nicht veröffentlicht.")) return true;
        try {
          await data.setStatus(id, "draft");
          if (ed?.id === id) ed.status = "draft";
          toast("Zurückgezogen");
          await load(true);
        } catch (err) { toast(errorText(err)); }
        render();
        return true;
      case "soc-delete":
        if (!confirm("Diesen Entwurf löschen?")) return true;
        try { await data.deletePost(id); toast("Gelöscht"); await load(true); } catch (err) { toast(errorText(err)); }
        return true;
      case "soc-publish-now": await publishNow(id); return true;
    }
    return false;
  }

  function onInput(e) {
    const ed = S.social.editor;
    const name = e.target.name ?? "";
    if (!ed || !name.startsWith("soc-")) return false;
    if (name === "soc-caption") ed.caption = e.target.value;
    else if (name === "soc-comment") ed.first_comment = e.target.value;
    else if (name === "soc-time") ed.scheduledLocal = e.target.value;
    else if (name.startsWith("soc-alt-")) ed.items[Number(name.slice(8))].alt = e.target.value;
    else return false;
    ed.dirty = true;
    refreshBits();
    return true;
  }

  async function onChange(e) {
    const name = e.target.name ?? "";
    const ed = S.social.editor;
    if (name === "soc-account" && ed) { ed.account_id = e.target.value; ed.dirty = true; refreshBits(); return true; }
    if (name === "soc-files") { await addFiles(e.target.files); return true; }
    if (name === "soc-cover" && ed && e.target.files[0]) { ed.cover = await probe(e.target.files[0]); ed.dirty = true; render(); return true; }
    if (name === "soc-package") { await importPackage(e.target.files); e.target.value = ""; return true; }
    return false;
  }

  function onDrop(e) {
    const zone = e.target.closest?.("[data-drop]");
    if (!zone) return false;
    e.preventDefault();
    zone.classList.remove("over");
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
    return true;
  }
  function onDragOver(e) {
    const zone = e.target.closest?.("[data-drop]");
    if (!zone) return false;
    e.preventDefault();
    zone.classList.add("over");
    return true;
  }

  // ---------- post packages (S4) ----------
  async function importPackage(fileList) {
    try {
      const pkg = await readPackage(fileList, accounts());
      const ed = {
        id: crypto.randomUUID(), isNew: true, status: "draft", account_id: pkg.account.id, kind: pkg.kind,
        caption: pkg.caption, first_comment: pkg.first_comment, scheduledLocal: pkg.suggested_time ? utcToZurichLocal(pkg.suggested_time) : tomorrowAt18(),
        items: await Promise.all(pkg.files.map(async (f, i) => ({ ...(await probe(f)), alt: pkg.alt[i] ?? "" }))),
        cover: pkg.cover ? await probe(pkg.cover) : null, source: "package", dirty: false, busy: false, preview: 0,
      };
      await persist(ed); // saved as a draft – a package is never approved
      toast(`Paket importiert: Entwurf für ${accountLabel(pkg.account)}`);
      await load(true);
      openEditor(posts().find((p) => p.id === ed.id) ?? null);
    } catch (err) {
      toast(`Paket nicht importiert: ${errorText(err)}`);
    }
  }

  return { load, view, overviewCard, badge, onClick, onInput, onChange, onDrop, onDragOver };
}
