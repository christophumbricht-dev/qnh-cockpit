// Swiss QR-bill (QR-Rechnung): the text inside the QR code («SPC» format, Swiss Implementation Guidelines 2.x)
// → payee, IBAN, amount, reference, message. Pure functions, unit-tested (tests/finance-qrbill.test.mjs).
// The code itself is read from a PDF or photo by reader.js.

// fixed line positions of the «SPC» payload (0-based)
const L = { type: 0, version: 1, coding: 2, iban: 3, cAdrTp: 4, cName: 5, cStreet: 6, cBuilding: 7, cZip: 8, cTown: 9, cCountry: 10,
  amount: 18, currency: 19, dAdrTp: 20, dName: 21, refType: 27, ref: 28, message: 29, trailer: 30, billInfo: 31 };

// the code cannot be used at all (not a QR-bill, cut off, IBAN check digits wrong …) – the message is for Christoph
export class QrBillError extends Error {
  name = "QrBillError";
}

const clean = (s) => String(s ?? "").trim();

// IBAN check digits (ISO 13616, mod 97)
export function ibanValid(iban) {
  const s = String(iban ?? "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const digits = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const d of digits) r = (r * 10 + Number(d)) % 97;
  return r === 1;
}
export const formatIban = (iban) => String(iban ?? "").replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();

// QR reference: 27 digits, shown in blocks of 5 from the right (2 + 5×5); RF creditor reference in blocks of 4
export function formatReference(ref) {
  const s = String(ref ?? "").replace(/\s+/g, "");
  if (/^\d{27}$/.test(s)) return `${s.slice(0, 2)} ${s.slice(2).replace(/(\d{5})(?=\d)/g, "$1 ")}`;
  if (/^RF/i.test(s)) return s.replace(/(.{4})(?=.)/g, "$1 ");
  return s;
}

// QR-IBAN: institution id (positions 5–9) 30000–31999 – only valid with a QR reference (QRR)
export const isQrIban = (iban) => { const iid = Number(String(iban ?? "").replace(/\s+/g, "").slice(4, 9)); return iid >= 30000 && iid <= 31999; };

// creditor reference «RF…» (ISO 11649): check digits mod 97, like an IBAN
export function scorValid(ref) {
  const s = String(ref ?? "").replace(/\s+/g, "").toUpperCase();
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(s)) return false;
  const digits = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const d of digits) r = (r * 10 + Number(d)) % 97;
  return r === 1;
}

// QR reference check digit (modulo 10, recursive)
export function qrReferenceValid(ref) {
  const s = String(ref ?? "").replace(/\s+/g, "");
  if (!/^\d{27}$/.test(s)) return false;
  const table = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
  let carry = 0;
  for (const d of s.slice(0, 26)) carry = table[(carry + Number(d)) % 10];
  return (10 - carry) % 10 === Number(s[26]);
}

// a real calendar day from YYMMDD (the 21st century), else null – «261340» is not a date
export function yymmdd(text) {
  const m = String(text ?? "").match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const iso = `20${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

// «//S1/10/10201409/11/260930/40/2:10;0:30» (Swico S1) → invoice number, invoice date, payment terms (days
// until net). Inside a value «\/» stands for «/» and «\\» for «\». Unknown or broken parts are skipped.
export function parseBillInfo(info) {
  const out = {};
  const s = clean(info);
  if (!s.startsWith("//S1/")) return out;
  // split at unescaped slashes: "", tag, value, tag, value …
  const parts = [""];
  for (let i = 4; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) parts[parts.length - 1] += s[++i];
    else if (c === "/") parts.push("");
    else parts[parts.length - 1] += c;
  }
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const [tag, value] = [parts[i], parts[i + 1]];
    if (!/^\d{2}$/.test(tag)) break; // out of step: stop rather than guess
    if (tag === "10" && value) out.invoiceNo = value;
    if (tag === "11") {
      // one date, or two (YYMMDDYYMMDD) – the first is the invoice date
      const d = yymmdd(value.slice(0, 6));
      if (d) out.invoiceDate = d; else if (value) out.badDate = value;
    }
    if (tag === "40") {
      // "2:10;0:30" = 2 % discount within 10 days, net within 30 days → the 0 % entry is the deadline
      const net = value.split(";").map((x) => x.split(":").map(Number)).find(([pct, days]) => pct === 0 && Number.isInteger(days) && days >= 0 && days <= 365);
      if (net) out.netDays = net[1];
    }
  }
  return out;
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// due date from the bill information, else today + 30 days; source says where it came from:
//   "terms" (invoice date + payment terms), "terms-today" (payment terms, no invoice date → from today),
//   "invoice-date" (invoice date + 30 days, no terms), "assumed" (today + 30 days)
export function suggestDue(billInfo, today) {
  if (billInfo.invoiceDate) return { date: addDays(billInfo.invoiceDate, billInfo.netDays ?? 30), source: billInfo.netDays != null ? "terms" : "invoice-date" };
  return { date: addDays(today, billInfo.netDays ?? 30), source: billInfo.netDays != null ? "terms-today" : "assumed" };
}
export const suggestDueDate = (billInfo, today) => suggestDue(billInfo, today).date;

const REF_MAX = 40; // fin_bills.reference
const fmtDay = (iso) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;

// → the bill fields plus `warnings` (German, for the form): things to check before paying. Throws QrBillError
// only when the code is unusable.
export function parseSwissQr(text, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  if (clean(lines[L.type]) !== "SPC") throw new QrBillError("Das ist kein QR-Code einer Schweizer QR-Rechnung.");
  if (!/^02\d\d$/.test(clean(lines[L.version]))) throw new QrBillError(`Unbekannte QR-Rechnungs-Version «${clean(lines[L.version])}».`);
  if (clean(lines[L.trailer]) !== "EPD") throw new QrBillError("Der QR-Code ist unvollständig (Ende «EPD» fehlt).");
  const warnings = [];
  const iban = clean(lines[L.iban]).replace(/\s+/g, "").toUpperCase();
  if (!ibanValid(iban)) throw new QrBillError("Die IBAN im QR-Code ist ungültig.");
  if (!/^(CH|LI)/.test(iban)) warnings.push(`Die IBAN ist aus ${iban.slice(0, 2)} – QR-Rechnungen erlauben nur Konten in der Schweiz oder in Liechtenstein. Bitte beim Rechnungssteller nachfragen.`);
  const amountText = clean(lines[L.amount]);
  const amount = amountText ? Number(amountText) : null;
  if (amountText && !(/^\d{1,9}(\.\d{1,2})?$/.test(amountText) && Number.isFinite(amount))) throw new QrBillError(`Betrag «${amountText}» ist ungültig.`);
  if (amount === 0) warnings.push("Betrag 0.00: Das ist eine Benachrichtigung («Nicht zur Zahlung verwenden») – hier ist nichts zu bezahlen.");
  let currency = clean(lines[L.currency]).toUpperCase() || "CHF";
  if (!["CHF", "EUR"].includes(currency)) {
    warnings.push(`Währung «${currency}» ist in einer QR-Rechnung nicht erlaubt (nur CHF oder EUR) – bitte prüfen.`);
    if (!/^[A-Z]{3}$/.test(currency)) currency = "CHF";
  }
  const refType = clean(lines[L.refType]).toUpperCase();
  let reference = clean(lines[L.ref]).replace(/\s+/g, "");
  if (refType === "QRR" && !qrReferenceValid(reference)) throw new QrBillError("Die QR-Referenz ist ungültig (Prüfziffer).");
  if (refType === "NON") reference = "";
  else if (refType === "SCOR") {
    reference = reference.toUpperCase();
    if (!scorValid(reference)) warnings.push("Die Referenz (RF…) hat eine falsche Prüfziffer – die Bank wird sie wohl ablehnen. Bitte mit der Rechnung vergleichen.");
  } else if (refType !== "QRR" && reference) {
    if (reference.length > REF_MAX) {
      warnings.push("Die Referenz im QR-Code hat keinen gültigen Typ und ist zu lang – nicht übernommen. Bitte von der Rechnung abschreiben.");
      reference = "";
    } else warnings.push(`Unbekannter Referenz-Typ «${refType || "leer"}» – bitte die Referenz prüfen.`);
  }
  if (reference.length > REF_MAX) reference = ""; // cannot happen for QRR (27) / SCOR (≤ 25); the database takes 40
  if (isQrIban(iban) && refType !== "QRR") warnings.push("QR-IBAN ohne QR-Referenz – diese Kombination lehnt die Bank ab. Bitte beim Rechnungssteller nachfragen.");
  if (!isQrIban(iban) && refType === "QRR") warnings.push("QR-Referenz mit einer normalen IBAN – diese Kombination lehnt die Bank ab. Bitte beim Rechnungssteller nachfragen.");
  // structured (S) address: street + number, zip, town; combined (K): two address lines
  const structured = clean(lines[L.cAdrTp]) === "S";
  const address = structured
    ? [`${clean(lines[L.cStreet])} ${clean(lines[L.cBuilding])}`.trim(), `${clean(lines[L.cZip])} ${clean(lines[L.cTown])}`.trim()]
    : [clean(lines[L.cStreet]), clean(lines[L.cBuilding])];
  const billInfo = parseBillInfo(lines[L.billInfo]);
  if (billInfo.badDate) warnings.push(`Das Rechnungsdatum im QR-Code («${billInfo.badDate}») ist kein gültiges Datum – ignoriert.`);
  const due = suggestDue(billInfo, today);
  if (due.date < today) warnings.push(`Die Fälligkeit (${fmtDay(due.date)}) liegt schon in der Vergangenheit – bitte prüfen.`);
  return {
    iban,
    payee: clean(lines[L.cName]).slice(0, 120),
    payeeAddress: address.filter(Boolean).join(", "),
    country: clean(lines[L.cCountry]),
    amount,
    currency,
    debtor: clean(lines[L.dName]),
    referenceType: refType,
    reference,
    message: clean(lines[L.message]).slice(0, 140),
    invoiceNo: (billInfo.invoiceNo ?? "").slice(0, 40),
    invoiceDate: billInfo.invoiceDate ?? null,
    netDays: billInfo.netDays ?? null,
    dueDate: due.date,
    dueSource: due.source,
    warnings,
  };
}
