// Swiss QR-bill (QR-Rechnung): the text inside the QR code («SPC» format, Swiss Implementation Guidelines 2.x)
// → payee, IBAN, amount, reference, message. Pure functions, unit-tested (tests/finance-qrbill.test.mjs).
// The code itself is read from a PDF or photo by reader.js.

// fixed line positions of the «SPC» payload (0-based)
const L = { type: 0, version: 1, coding: 2, iban: 3, cAdrTp: 4, cName: 5, cStreet: 6, cBuilding: 7, cZip: 8, cTown: 9, cCountry: 10,
  amount: 18, currency: 19, dAdrTp: 20, dName: 21, refType: 27, ref: 28, message: 29, trailer: 30, billInfo: 31 };

export class QrBillError extends Error {}

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

// QR reference check digit (modulo 10, recursive)
export function qrReferenceValid(ref) {
  const s = String(ref ?? "").replace(/\s+/g, "");
  if (!/^\d{27}$/.test(s)) return false;
  const table = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
  let carry = 0;
  for (const d of s.slice(0, 26)) carry = table[(carry + Number(d)) % 10];
  return (10 - carry) % 10 === Number(s[26]);
}

// «//S1/10/10201409/11/260930/40/2:10;0:30» → invoice number, invoice date, payment terms (days until net)
export function parseBillInfo(info) {
  const out = {};
  const s = clean(info);
  if (!s.startsWith("//S1/")) return out;
  const parts = s.slice(5).split(/\/(?=\d{2}\/)/); // tags are /NN/
  for (const p of parts) {
    const m = p.match(/^(\d{2})\/(.*)$/s);
    if (!m) continue;
    const [, tag, value] = m;
    if (tag === "10") out.invoiceNo = value.replace(/\\\//g, "/");
    if (tag === "11") {
      const d = value.match(/^(\d{2})(\d{2})(\d{2})/);
      if (d) out.invoiceDate = `20${d[1]}-${d[2]}-${d[3]}`;
    }
    if (tag === "40") {
      // "2:10;0:30" = 2 % discount within 10 days, net within 30 days → the 0 % entry is the deadline
      const net = value.split(";").map((x) => x.split(":").map(Number)).find(([pct]) => pct === 0);
      if (net && Number.isFinite(net[1])) out.netDays = net[1];
    }
  }
  return out;
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// due date from the bill information, else today + 30 days
export function suggestDueDate(billInfo, today) {
  if (billInfo.invoiceDate) return addDays(billInfo.invoiceDate, billInfo.netDays ?? 30);
  return addDays(today, billInfo.netDays ?? 30);
}

export function parseSwissQr(text, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  if (clean(lines[L.type]) !== "SPC") throw new QrBillError("Das ist kein QR-Code einer Schweizer QR-Rechnung.");
  if (!/^02\d\d$/.test(clean(lines[L.version]))) throw new QrBillError(`Unbekannte QR-Rechnungs-Version «${clean(lines[L.version])}».`);
  if (clean(lines[L.trailer]) !== "EPD") throw new QrBillError("Der QR-Code ist unvollständig (Ende «EPD» fehlt).");
  const iban = clean(lines[L.iban]).replace(/\s+/g, "").toUpperCase();
  if (!ibanValid(iban)) throw new QrBillError("Die IBAN im QR-Code ist ungültig.");
  const amountText = clean(lines[L.amount]);
  const amount = amountText ? Number(amountText) : null;
  if (amountText && !(Number.isFinite(amount) && amount >= 0)) throw new QrBillError(`Betrag «${amountText}» ist ungültig.`);
  const refType = clean(lines[L.refType]);
  const reference = clean(lines[L.ref]).replace(/\s+/g, "");
  if (refType === "QRR" && !qrReferenceValid(reference)) throw new QrBillError("Die QR-Referenz ist ungültig (Prüfziffer).");
  // structured (S) address: street + number, zip, town; combined (K): two address lines
  const structured = clean(lines[L.cAdrTp]) === "S";
  const address = structured
    ? [`${clean(lines[L.cStreet])} ${clean(lines[L.cBuilding])}`.trim(), `${clean(lines[L.cZip])} ${clean(lines[L.cTown])}`.trim()]
    : [clean(lines[L.cStreet]), clean(lines[L.cBuilding])];
  const billInfo = parseBillInfo(lines[L.billInfo]);
  return {
    iban,
    payee: clean(lines[L.cName]),
    payeeAddress: address.filter(Boolean).join(", "),
    country: clean(lines[L.cCountry]),
    amount,
    currency: clean(lines[L.currency]) || "CHF",
    debtor: clean(lines[L.dName]),
    referenceType: refType,
    reference: refType === "NON" ? "" : reference,
    message: clean(lines[L.message]),
    invoiceNo: billInfo.invoiceNo ?? "",
    invoiceDate: billInfo.invoiceDate ?? null,
    dueDate: suggestDueDate(billInfo, today),
  };
}
