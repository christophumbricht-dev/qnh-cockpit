import test from "node:test";
import assert from "node:assert/strict";
import { QrBillError, formatIban, formatReference, ibanValid, isQrIban, parseBillInfo, parseSwissQr, qrReferenceValid, scorValid, yymmdd } from "../src/finance/qrbill.js";
import { errorText } from "../src/format.js";

// sample payload in the layout of the Swiss Implementation Guidelines (QR-IBAN + QR reference, structured address)
const SAMPLE = [
  "SPC", "0200", "1", "CH4431999123000889012",
  "S", "Robert Schneider AG", "Rue du Lac", "1268", "2501", "Biel", "CH",
  "", "", "", "", "", "", "",
  "1949.75", "CHF",
  "S", "Pia-Maria Rutschmann-Schnyder", "Grosse Marktgasse", "28", "9400", "Rorschach", "CH",
  "QRR", "210000000003139471430009017", "Order of 15 October 2026", "EPD",
  "//S1/10/10201409/11/261015/20/1400.000-53/30/106017086/31/180508/32/7.7/40/2:10;0:30",
].join("\r\n");

test("QR-bill: payee, IBAN, amount, reference, message and a due date from the payment terms", () => {
  const b = parseSwissQr(SAMPLE, { today: "2026-10-20" });
  assert.equal(b.payee, "Robert Schneider AG");
  assert.equal(b.payeeAddress, "Rue du Lac 1268, 2501 Biel");
  assert.equal(b.iban, "CH4431999123000889012");
  assert.equal(b.amount, 1949.75);
  assert.equal(b.currency, "CHF");
  assert.equal(b.referenceType, "QRR");
  assert.equal(b.reference, "210000000003139471430009017");
  assert.equal(b.message, "Order of 15 October 2026");
  assert.equal(b.invoiceNo, "10201409");
  assert.equal(b.invoiceDate, "2026-10-15");
  assert.equal(b.dueDate, "2026-11-14"); // net 30 days after the invoice date
  assert.equal(b.dueSource, "terms");
  assert.deepEqual(b.warnings, []);
});

// SAMPLE with some lines changed (index → value); billInfo = line 31
const edit = (changes) => { const l = SAMPLE.split("\r\n"); for (const [i, v] of Object.entries(changes)) l[i] = v; return l.join("\n"); };
const NORMAL_IBAN = "CH9300762011623852957";

test("QR-bill: a broken invoice date is ignored (no crash), the note does not claim payment terms", () => {
  const bad = parseSwissQr(edit({ 31: "//S1/10/123/11/261340/40/0:30" }), { today: "2026-10-20" });
  assert.equal(bad.invoiceDate, null);
  assert.equal(bad.dueDate, "2026-11-19"); // terms from today
  assert.equal(bad.dueSource, "terms-today");
  assert.match(bad.warnings.join(" "), /«261340»\) ist kein gültiges Datum/);
  // /11/ without /40/: invoice date + 30 days – an assumption, and a date already past is flagged
  const noTerms = parseSwissQr(edit({ 31: "//S1/10/123/11/260801" }), { today: "2026-10-20" });
  assert.equal(noTerms.dueDate, "2026-08-31");
  assert.equal(noTerms.dueSource, "invoice-date");
  assert.match(noTerms.warnings.join(" "), /Vergangenheit/);
  assert.equal(yymmdd("260229"), null);
  assert.equal(yymmdd("280229"), "2028-02-29");
});

test("QR-bill: friendly warnings for codes the bank would refuse", () => {
  const w = (changes) => parseSwissQr(edit(changes), { today: "2026-10-20" }).warnings.join(" | ");
  assert.match(w({ 3: "DE89370400440532013000", 27: "NON", 28: "" }), /nur Konten in der Schweiz oder in Liechtenstein/);
  assert.equal(w({ 3: "LI0208800000017197386", 27: "NON", 28: "" }), ""); // Liechtenstein is fine
  assert.match(w({ 27: "NON", 28: "" }), /QR-IBAN ohne QR-Referenz/);
  assert.match(w({ 3: NORMAL_IBAN }), /QR-Referenz mit einer normalen IBAN/);
  assert.equal(w({ 3: NORMAL_IBAN, 27: "SCOR", 28: "RF18539007547034" }), "");
  assert.match(w({ 3: NORMAL_IBAN, 27: "SCOR", 28: "RF19539007547034" }), /RF…\) hat eine falsche Prüfziffer/);
  assert.match(w({ 19: "USD" }), /nur CHF oder EUR/);
  assert.match(w({ 18: "0.00" }), /Nicht zur Zahlung verwenden/);
  const long = parseSwissQr(edit({ 3: NORMAL_IBAN, 27: "", 28: "X".repeat(60) }), { today: "2026-10-20" });
  assert.equal(long.reference, ""); // never more than the database takes (40), never cut in the middle
  assert.match(long.warnings.join(" "), /zu lang/);
  assert.throws(() => parseSwissQr(edit({ 18: "1e3" })), /Betrag/);
});

test("QR-bill: parser problems keep their own message (not the sign-in text)", () => {
  let err;
  try { parseSwissQr(SAMPLE.replace("CH4431999123000889012", "CH4431999123000889013")); } catch (e) { err = e; }
  assert.ok(err instanceof QrBillError);
  assert.equal(errorText(err), "Die IBAN im QR-Code ist ungültig.");
  assert.equal(errorText(new QrBillError("Betrag «invalid» ist ungültig.")), "Betrag «invalid» ist ungültig.");
});

test("QR-bill: open amount, no reference, no bill information → due in 30 days", () => {
  const lines = SAMPLE.split("\r\n");
  lines[18] = ""; lines[27] = "NON"; lines[28] = ""; lines.length = 31;
  const b = parseSwissQr(lines.join("\n"), { today: "2026-10-20" });
  assert.equal(b.amount, null);
  assert.equal(b.reference, "");
  assert.equal(b.dueDate, "2026-11-19");
});

test("QR-bill: wrong codes are refused with a German message", () => {
  assert.throws(() => parseSwissQr("https://example.com"), /kein .*QR-Rechnung/);
  assert.throws(() => parseSwissQr(SAMPLE.replace("CH4431999123000889012", "CH4431999123000889013")), /IBAN/);
  assert.throws(() => parseSwissQr(SAMPLE.replace("210000000003139471430009017", "210000000003139471430009018")), /Prüfziffer/);
  assert.throws(() => parseSwissQr(SAMPLE.replace("EPD", "XYZ")), /unvollständig/);
});

test("QR-bill helpers: IBAN and reference checks and display", () => {
  assert.equal(ibanValid("CH93 0076 2011 6238 5295 7"), true);
  assert.equal(ibanValid("CH93 0076 2011 6238 5295 8"), false);
  assert.equal(formatIban("CH4431999123000889012"), "CH44 3199 9123 0008 8901 2");
  assert.equal(qrReferenceValid("210000000003139471430009017"), true);
  assert.equal(formatReference("210000000003139471430009017"), "21 00000 00003 13947 14300 09017");
  assert.equal(formatReference("RF18539007547034"), "RF18 5390 0754 7034");
  assert.deepEqual(parseBillInfo("//S1/11/261001/40/0:20"), { invoiceDate: "2026-10-01", netDays: 20 });
  assert.deepEqual(parseBillInfo("free text"), {});
  // escapes inside values: \/ is «/», \\ is «\» – and an escaped slash before digits does not start a new tag
  assert.deepEqual(parseBillInfo("//S1/10/A\\\\B\\/12/11/261015"), { invoiceNo: "A\\B/12", invoiceDate: "2026-10-15" });
  assert.equal(isQrIban("CH4431999123000889012"), true);
  assert.equal(isQrIban(NORMAL_IBAN), false);
  assert.equal(scorValid("RF18 5390 0754 7034"), true);
  assert.equal(scorValid("RF18539007547035"), false);
});
