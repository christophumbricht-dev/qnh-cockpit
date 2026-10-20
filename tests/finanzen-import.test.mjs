// scripts/finanzen-lib.mjs: ausgaben.json → Finanzen rows. Invented data only (the repository is public).
import test from "node:test";
import assert from "node:assert/strict";
import { ImportError, billRow, costName, fileType, planImport, subscriptionOf } from "../scripts/finanzen-lib.mjs";
import { moneyList, owedPrivately, sumBy } from "../src/finance/calc.js";

const NOW = "2026-10-20T12:00:00.000Z";
const e = (over) => ({ date: "2026-03-02", vendor: "Beispiel Cloud Ltd", title: "Guthaben", category: "Software", app: "downwind", currency: "USD", net: 10, vat: 0.81, gross: 10.81, doc_no: "T-100", file: "2026-03-02_Beispiel_T-100.pdf", reimburse: true, status: "offen", ...over });

test("import: a receipt paid privately becomes a paid bill the company owes back", () => {
  assert.deepEqual(billRow(e({ paid_with: "Kreditkarte", remark: "nur einmal erfasst" }), NOW), {
    payee: "Beispiel Cloud Ltd", amount: 10.81, currency: "USD", due_date: "2026-03-02", status: "paid", paid_at: "2026-03-02T10:00:00Z",
    net: 10, vat: 0.81, paid_with: "Kreditkarte", paid_by: "privat", reimbursed_at: null, invoice_no: "T-100", scope: "downwind",
    category: "Software", message: "Guthaben", note: "nur einmal erfasst", source: "claude",
  });
  assert.equal(billRow(e({ reimburse: false }), NOW), null);
  assert.equal(billRow(e({ status: "privat" }), NOW), null);
  assert.equal(billRow(e({ status: "bezahlt_gmbh" }), NOW).paid_by, "firma");
  assert.equal(billRow(e({ status: "zurueckbezahlt" }), NOW).reimbursed_at, NOW);
  assert.equal(billRow(e({ status: "zurueckbezahlt", reimbursed_at: "2026-04-01" }), NOW).reimbursed_at, "2026-04-01T10:00:00Z");
  assert.throws(() => billRow(e({ date: "02.03.2026" }), NOW), ImportError);
  assert.throws(() => billRow(e({ gross: undefined }), NOW), /gross/);
  assert.throws(() => billRow(e({ vat: "viel" }), NOW), /vat/);
  assert.throws(() => billRow(e({ app: "Down Wind" }), NOW), /App\/Marke/);
});

test("import: subscriptions are recognised from recurring, renews or «(bis …)»", () => {
  assert.deepEqual(subscriptionOf(e({ recurring: "monatlich, nächste 2026-04-02" })), { interval: "monthly", next_due: "2026-04-02", notice_days: 0 });
  assert.deepEqual(subscriptionOf(e({ renews: "2027-03-02" })), { interval: "yearly", next_due: "2027-03-02", notice_days: 30 });
  assert.deepEqual(subscriptionOf(e({ title: "Entwicklerkonto (bis 4.3.2027)" })), { interval: "yearly", next_due: "2027-03-04", notice_days: 30 });
  assert.equal(subscriptionOf(e({})), null);
  assert.equal(costName(e({ title: "Entwicklerkonto (bis 4.3.2027)" })), "Entwicklerkonto");
  assert.equal(costName(e({ title: "Chat Abo Plus, März (02.03.–01.04.2026)" })), "Chat Abo Plus");
  assert.equal(costName(e({ title: "x", cost_name: "Mein Abo" })), "Mein Abo");
  assert.equal(fileType("a.PDF"), "application/pdf");
  assert.equal(fileType("a.gif"), null);
});

test("import: running it again changes nothing; doubles and private receipts are skipped", () => {
  const list = [
    e({}),
    e({ doc_no: "T-100", remark: "zweimal geschickt" }),
    e({ doc_no: "T-101", gross: 20, recurring: "monatlich, nächste 2026-04-02", title: "Chat Abo Plus, März", vendor: "Beispiel Store" }),
    e({ doc_no: "T-102", date: "2026-04-02", gross: 20, recurring: "monatlich, nächste 2026-05-02", title: "Chat Abo Plus, April", vendor: "Beispiel Store" }),
    e({ doc_no: "T-103", reimburse: false, status: "privat" }),
  ];
  const plan = planImport(list, {}, NOW);
  assert.equal(plan.bills.length, 3);
  assert.deepEqual(plan.skipped.map((s) => s.why), ["doppelt in der Datei", "privat – nicht übernommen"]);
  assert.equal(plan.costs.length, 1); // the two monthly receipts share one subscription
  assert.equal(plan.bills[1].cost, plan.costs[0]);
  assert.equal(plan.bills[2].cost, plan.costs[0]);
  assert.deepEqual({ ...plan.costs[0] }, { name: "Chat Abo Plus", provider: "Beispiel Store", scope: "downwind", category: "Software", amount: 20, currency: "USD", interval: "monthly", next_due: "2026-04-02", notice_days: 0, payment: "", note: "", active: true });

  // second run: everything is already there (case of the payee does not matter)
  const again = planImport(list, { bills: [{ payee: "beispiel cloud ltd", invoice_no: "T-100" }, { payee: "Beispiel Store", invoice_no: "T-101" }, { payee: "Beispiel Store", invoice_no: "T-102" }], costs: [{ id: "c1", name: "chat abo plus" }] }, NOW);
  assert.equal(again.bills.length, 0);
  assert.equal(again.costs.length, 0);
  // a new receipt of a known subscription links to it
  const more = planImport([e({ doc_no: "T-104", recurring: "monatlich, nächste 2026-06-02", title: "Chat Abo Plus, Mai", vendor: "Beispiel Store" })], { costs: [{ id: "c1", name: "Chat Abo Plus" }] }, NOW);
  assert.equal(more.bills[0].cost.id, "c1");
  assert.equal(more.costs.length, 0);
  assert.throws(() => planImport({ expenses: [] }), /expenses/);
  assert.throws(() => planImport([e({ file: "beleg.gif" })]), /nur PDF/);
});

test("owed: open private receipts per currency, never converted", () => {
  const rows = [
    { paid_by: "privat", amount: 10.81, currency: "USD", status: "paid" },
    { paid_by: "privat", amount: 20, currency: "CHF", status: "paid" },
    { paid_by: "privat", amount: 5, currency: "CHF", status: "paid", reimbursed_at: NOW },
    { paid_by: "privat", amount: 7, currency: "CHF", status: "cancelled" },
    { paid_by: "firma", amount: 99, currency: "CHF", status: "paid" },
  ];
  assert.equal(moneyList(sumBy(rows.filter(owedPrivately))), "USD 10.81 + CHF 20.00");
});
