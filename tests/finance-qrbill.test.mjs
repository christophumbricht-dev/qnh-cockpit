import test from "node:test";
import assert from "node:assert/strict";
import { formatIban, formatReference, ibanValid, parseBillInfo, parseSwissQr, qrReferenceValid } from "../src/finance/qrbill.js";

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
});
