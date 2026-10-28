import { test } from "node:test";
import assert from "node:assert/strict";
import { CliError, approvalCarriesOver, checkMeta, checkScenes, itemFromPost, rejectPatch, resolvePatch, sha256, slugOf, statusAfterNewVersion,
  summary, versionFromPost, workMarkers } from "../scripts/studio-lib.mjs";

test("slugOf makes package folders studio names", () => {
  assert.equal(slugOf("2026-11-08_Panel-1"), "2026-11-08_panel-1");
  assert.equal(slugOf("Föhn Langvideo"), "fohn-langvideo");
  assert.throws(() => slugOf("!"), CliError);
});

test("checkScenes keeps order and refuses broken scenes", () => {
  assert.deepEqual(checkScenes([{ id: "a", start: 0, end: 5 }, { id: "b", label: "B", start: 5, end: 9 }], 9.2),
    [{ id: "a", label: "a", start: 0, end: 5 }, { id: "b", label: "B", start: 5, end: 9 }]);
  assert.throws(() => checkScenes([{ id: "a", start: 0, end: 5 }, { id: "a", start: 5, end: 6 }]), /zweimal/);
  assert.throws(() => checkScenes([{ id: "a", start: 4, end: 5 }, { id: "b", start: 2, end: 6 }]), /vor dem Ende/);
  assert.throws(() => checkScenes([{ id: "a", start: 0, end: 50 }], 30), /nach dem Video/);
  assert.throws(() => checkScenes({}), CliError);
});

test("checkMeta normalises lists and checks title length and fps", () => {
  const m = checkMeta({ titles: "Föhn", shorts: ["Kurz"], fps: 30 });
  assert.deepEqual(m.titles, ["Föhn"]);
  assert.deepEqual(m.shorts, [{ title: "Kurz" }]);
  assert.throws(() => checkMeta({ titles: ["x".repeat(101)] }), /100/);
  assert.throws(() => checkMeta({ fps: 500 }), /fps/);
});

test("summary splits Christoph's and Claude's turn", () => {
  const items = [{ id: "1", status: "review1" }, { id: "2", status: "work" }, { id: "3", status: "approved" }, { id: "4", status: "review2" }];
  const markers = [{ item_id: "2", status: "open" }, { item_id: "2", status: "done" }, { item_id: "2", status: "not_yet" }];
  const s = summary(items, markers);
  assert.deepEqual(s.christoph.map((i) => i.id), ["1", "4"]);
  assert.equal(s.claude[0].open.length, 2);
  assert.equal(s.approved.length, 1);
});

test("workMarkers: open and «noch nicht», in order of page and time", () => {
  const ms = [{ id: "c", item_id: "x", status: "open", at: 30 }, { id: "a", item_id: "x", status: "not_yet", at: 2 }, { id: "d", item_id: "x", status: "draft", at: 1 },
    { id: "b", item_id: "x", status: "open", at: null, target: "caption" }];
  assert.deepEqual(workMarkers({ id: "x" }, ms).map((m) => m.id), ["b", "a", "c"]);
});

test("resolve and reject are done in the next version and need a reason", () => {
  assert.deepEqual(resolvePatch({ current_version: 2 }, " kürzer ", "all", "Keine Striche"),
    { status: "done", note: "kürzer", scope: "all", rule: "Keine Striche", done_version: 3 });
  assert.equal(resolvePatch({ current_version: 1 }, "ok").scope, null);
  assert.throws(() => resolvePatch({ current_version: 1 }, ""), CliError);
  assert.throws(() => resolvePatch({ current_version: 1 }, "x", "all"), /Regeltext/);
  assert.throws(() => resolvePatch({ current_version: 1 }, "x", "alle", "r"), /post, channel oder all/);
  assert.equal(rejectPatch({ current_version: 4 }, "Fakt stimmt").done_version, 5);
  assert.throws(() => rejectPatch({ current_version: 1 }, " "), CliError);
});

test("a new version: review 1 stays, otherwise review 2", () => {
  assert.equal(statusAfterNewVersion("review1"), "review1");
  assert.equal(statusAfterNewVersion("work"), "review2");
  assert.equal(statusAfterNewVersion("approved"), "review2");
});

test("versionFromPost and itemFromPost from a Social draft", () => {
  const reel = { id: "p1", kind: "reel", caption: "Oil pressure high\nmore", first_comment: "Answer?", scheduled_at: "2026-11-08T17:00:00Z",
    media: [{ path: "p1/a.mp4", type: "video/mp4", still: "p1/a.jpg", duration: 18.5 }] };
  const v = versionFromPost(reel, { assumptions: ["Musik −14 LUFS"] });
  assert.deepEqual(v.source, { kind: "storage", path: "p1/a.mp4", still: "p1/a.jpg" });
  assert.equal(v.duration, 18.5);
  assert.deepEqual(v.meta, { caption: reel.caption, first_comment: "Answer?", assumptions: ["Musik −14 LUFS"] });
  const it = itemFromPost(reel, { app_id: "leesidelab", platform: "instagram" }, "2026-11-08-panel-1");
  assert.deepEqual(it, { channel: "leesidelab/instagram", format: "reel", title: "Oil pressure high", slug: "2026-11-08-panel-1", day: "2026-11-08", social_post_id: "p1" });
  const car = versionFromPost({ kind: "carousel", media: [{ path: "a.jpg", type: "image/jpeg" }, { path: "b.jpg", type: "image/jpeg" }] });
  assert.deepEqual(car.source, { kind: "storage", pages: ["a.jpg", "b.jpg"] });
  const yt = itemFromPost({ id: "p2", kind: "reel", title: "Föhn", caption: "", media: [{ type: "video/mp4", duration: 340 }] }, { app_id: "leesidelab", platform: "youtube" }, "foehn");
  assert.equal(yt.format, "video_long");
});

test("a studio approval carries over only for exactly the approved content", () => {
  const bytes = Buffer.from("video");
  const h = sha256(bytes);
  const version = { hash: h, meta: { titles: ["A", "B"], chosen_title: 1, description: "Text" } };
  const item = { status: "approved", approved_hash: h };
  const draft = { videoHash: h, caption: "Text ", title: "B" };
  assert.equal(approvalCarriesOver(item, version, draft), true);
  assert.equal(approvalCarriesOver(item, version, { ...draft, title: "A" }), false);
  assert.equal(approvalCarriesOver(item, version, { ...draft, caption: "Text neu" }), false);
  assert.equal(approvalCarriesOver(item, version, { ...draft, videoHash: sha256(Buffer.from("other")) }), false);
  assert.equal(approvalCarriesOver({ ...item, status: "review2" }, version, draft), false);
  assert.equal(approvalCarriesOver({ ...item, approved_hash: "old" }, version, draft), false);
});

import { checkDraft, draftScenes, ideaRow, ideasOverview, wrap } from "../scripts/studio-lib.mjs";

test("ideaRow checks channel, day, title and pitch", () => {
  const r = ideaRow({ channel: "leesidelab/youtube", day: "2026-11-20", title: "Nebel im Mittelland", pitch: "Hochnebel" });
  assert.deepEqual(r, { channel: "leesidelab/youtube", format: "video_long", title: "Nebel im Mittelland", pitch: "Hochnebel", day: "2026-11-20", status: "idea", slug: "2026-11-20-nebel-im-mittelland" });
  assert.throws(() => ideaRow({ ...r, channel: "leesidelab" }), /Kanal/);
  assert.throws(() => ideaRow({ ...r, day: "20.11.2026" }), /YYYY/);
  assert.throws(() => ideaRow({ ...r, pitch: " " }), /worum/);
  assert.throws(() => ideaRow({ ...r, format: "movie" }), /format/);
});

test("ideasOverview: a dropped idea needs a replacement until another idea takes its day", () => {
  const items = [
    { id: 1, channel: "c/youtube", day: "2026-11-20", status: "dropped" },
    { id: 2, channel: "c/youtube", day: "2026-11-21", status: "dropped" },
    { id: 3, channel: "c/youtube", day: "2026-11-21", status: "idea" },
    { id: 4, channel: "c/youtube", day: "2026-11-22", status: "idea_ok" },
  ];
  const o = ideasOverview(items);
  assert.deepEqual([o.waiting.map((i) => i.id), o.accepted.map((i) => i.id), o.replace.map((i) => i.id)], [[3], [4], [1]]);
});

test("draft: scene times from the spoken lengths, checks and wrapping", () => {
  assert.deepEqual(draftScenes([{ id: "a" }, { id: "b", label: "B" }], [2, 3.25], 0.5),
    [{ id: "a", label: "a", start: 0, end: 2.5 }, { id: "b", label: "B", start: 2.5, end: 6.25 }]);
  assert.deepEqual(checkDraft({ scenes: [{ text: " Hi " }] }), [{ id: "s1", label: "s1", text: "Hi", image: null }]);
  assert.throws(() => checkDraft({ scenes: [] }), /scenes/);
  assert.throws(() => checkDraft({ scenes: [{ id: "a", text: "x" }, { id: "a", text: "y" }] }), /zweimal/);
  assert.equal(wrap("one two three four", 9), "one two\nthree\nfour");
});

import { pickIdea } from "../scripts/studio-lib.mjs";
test("pickIdea: the one idea of that day, else the furthest along, never a guess", () => {
  assert.equal(pickIdea([]), null);
  assert.equal(pickIdea([{ id: 1, status: "idea_ok" }]).id, 1);
  assert.equal(pickIdea([{ id: 1, status: "idea" }, { id: 2, status: "draft" }]).id, 2);
  assert.equal(pickIdea([{ id: 1, status: "draft" }, { id: 2, status: "draft" }]), null);
  assert.equal(pickIdea([{ id: 1, status: "dropped" }]), null);
});

import { adoptStatus, placeholderText } from "../scripts/studio-lib.mjs";
test("adoptStatus maps the Social plan to the Ablauf", () => {
  const ph = (p) => String(p.caption).startsWith("PLATZHALTER") && !(p.media ?? []).length;
  assert.equal(adoptStatus({ status: "draft", caption: "PLATZHALTER · Föhn", media: [] }, ph), "idea");
  assert.equal(adoptStatus({ status: "draft", caption: "Föhn", media: [{ path: "a.mp4" }] }, ph), "review1");
  assert.equal(adoptStatus({ status: "failed", caption: "x", media: [{ path: "a.mp4" }] }, ph), "review1");
  assert.equal(adoptStatus({ status: "approved", caption: "x", media: [{}] }, ph), "approved");
  assert.equal(adoptStatus({ status: "published", caption: "x", media: [{}] }, ph), "approved");
  assert.equal(adoptStatus({ status: "cancelled", caption: "x" }, ph), null);
  assert.deepEqual(placeholderText("PLATZHALTER · Föhn Teil 2\nWarum der Norden warm wird"), { title: "Föhn Teil 2", pitch: "Warum der Norden warm wird" });
  assert.deepEqual(placeholderText("PLATZHALTER · Unfall-Reel"), { title: "Unfall-Reel", pitch: "Unfall-Reel" });
});

import { dailyDue, requestRow, summaryOf } from "../scripts/studio-lib.mjs";
test("dailyDue: from 08:00 Swiss time, once per Swiss day", () => {
  assert.equal(dailyDue(new Date("2026-10-29T06:55:00Z"), null), false);            // 07:55 Zurich (CET)
  assert.equal(dailyDue(new Date("2026-10-29T07:00:00Z"), null), true);             // 08:00
  assert.equal(dailyDue(new Date("2026-10-29T07:05:00Z"), "2026-10-29T07:00:10Z"), false);
  assert.equal(dailyDue(new Date("2026-10-30T07:01:00Z"), "2026-10-29T07:00:10Z"), true);
  assert.equal(dailyDue(new Date("2026-07-01T06:01:00Z"), null), true);             // 08:01 summer time
});
test("summaryOf takes the report after ZUSAMMENFASSUNG:", () => {
  assert.equal(summaryOf("lots of work\nZUSAMMENFASSUNG: 2 Ideen, 1 Entwurf."), "2 Ideen, 1 Entwurf.");
  assert.equal(summaryOf(""), "(kein Bericht)");
  assert.equal(summaryOf("x".repeat(3000)).length, 1500);
});
test("requestRow: voicing needs sentences and credits", () => {
  assert.deepEqual(requestRow({ title: "Vertonen: Föhn", sentences: "12", credits: "1200" }), { kind: "voice", title: "Vertonen: Föhn", body: "", sentences: 12, credits: 1200, item_id: null });
  assert.throws(() => requestRow({ title: "Vertonen" }), /saetze/);
  assert.throws(() => requestRow({ title: "", sentences: 1, credits: 1 }), /titel/);
  assert.equal(requestRow({ title: "Frage", kind: "other" }).sentences, null);
});
