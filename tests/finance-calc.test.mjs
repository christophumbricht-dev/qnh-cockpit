import test from "node:test";
import assert from "node:assert/strict";
import { addMonths, financeDue, monthly, monthlyTotals, moneyList, nextDue, nextRenewal, parseAmount, toCsv, upcoming } from "../src/finance/calc.js";

const cost = (over) => ({ name: "Supabase", amount: 25, currency: "USD", interval: "monthly", next_due: "2026-01-08", notice_days: 0, active: true, scope: "qnh", ...over });

test("monthly equivalents and totals per currency", () => {
  assert.equal(monthly(cost({ interval: "yearly", amount: 120 })), 10);
  assert.equal(monthly(cost({ interval: "quarterly", amount: 30 })), 10);
  assert.equal(monthly(cost({ interval: "once", amount: 30 })), 0);
  assert.deepEqual(monthlyTotals([cost({}), cost({ currency: "CHF", amount: 12, interval: "yearly" }), cost({ active: false })]), { USD: 25, CHF: 1 });
  assert.equal(moneyList({ CHF: 1234.5, USD: 0 }), "CHF 1’234.50");
});

test("renewals roll forward without drifting the day of the month", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(nextRenewal(cost({ next_due: "2026-01-31" }), "2026-03-01"), "2026-03-31"); // not the 28th
  assert.equal(nextRenewal(cost({ interval: "yearly", next_due: "2025-11-02" }), "2026-10-20"), "2026-11-02");
  assert.equal(nextRenewal(cost({ interval: "once", next_due: "2026-10-01" }), "2026-10-20"), null);
  assert.equal(nextRenewal(cost({ next_due: null }), "2026-10-20"), null);
});

test("recurring tasks: the next due date is never in the past", () => {
  assert.equal(nextDue("2026-09-30", "quarterly", "2026-10-20"), "2026-12-30");
  assert.equal(nextDue("2026-10-20", "weekly", "2026-10-20"), "2026-10-27");
  assert.equal(nextDue("2026-08-01", "monthly", "2026-10-20"), "2026-11-01"); // done late: skips the missed months
  assert.equal(nextDue(null, "yearly", "2026-10-20"), "2027-10-20");
});

test("what is due: open bills by date, renewal reminders only when their notice period starts", () => {
  const bills = [
    { payee: "Infomaniak", amount: 59.4, currency: "CHF", due_date: "2026-10-25", status: "open" },
    { payee: "Old", amount: 10, currency: "CHF", due_date: "2026-10-01", status: "paid" },
    { payee: "Notar", amount: null, currency: "CHF", due_date: null, status: "open" },
  ];
  const costs = [cost({ name: "Apple", interval: "yearly", next_due: "2026-11-15", notice_days: 30 }), cost({ name: "Domain", interval: "yearly", next_due: "2027-06-01", notice_days: 30 })];
  const due = financeDue(costs, bills, "2026-10-20");
  assert.deepEqual(due.map((d) => [d.kind, d.row.payee ?? d.row.name, d.days]), [["bill", "Infomaniak", 5], ["renewal", "Apple", 26], ["bill", "Notar", null]]);
});

test("next 30 days: every renewal and open bill", () => {
  const up = upcoming([cost({ next_due: "2026-10-08" })], [{ payee: "X", amount: 5, currency: "CHF", due_date: "2026-11-01", status: "open" }], "2026-10-20");
  assert.deepEqual(up.map((u) => [u.kind, u.date]), [["bill", "2026-11-01"], ["renewal", "2026-11-08"]]);
});

test("amounts typed the Swiss way", () => {
  assert.equal(parseAmount("1'234.50"), 1234.5);
  assert.equal(parseAmount("CHF 99.–"), 99);
  assert.equal(parseAmount("1 234,50"), 1234.5);
  assert.equal(parseAmount(""), null);
  assert.ok(Number.isNaN(parseAmount("abc")));
});

test("CSV: semicolons, quotes, no formulas", () => {
  const csv = toCsv(["Name", "Betrag"], [["Müller; AG", 10], ["=HYPERLINK(1)", 2]]);
  assert.ok(csv.startsWith("﻿Name;Betrag\r\n"));
  assert.match(csv, /"Müller; AG";10/);
  assert.match(csv, /"'=HYPERLINK\(1\)";2/);
});
