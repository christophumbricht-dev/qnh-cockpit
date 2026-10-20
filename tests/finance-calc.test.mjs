import test from "node:test";
import assert from "node:assert/strict";
import { addMonths, amountText, billDue, billFileType, bookingDay, exportPeriod, financeDue, inPeriod, monthly, monthlyTotals, moneyList, nextDue, nextRenewal, parseAmount, recurringDone, toCsv, upcoming, zurichDay } from "../src/finance/calc.js";

const cost = (over) => ({ name: "Supabase", amount: 25, currency: "USD", interval: "monthly", next_due: "2026-01-08", notice_days: 0, active: true, scope: "qnh", ...over });

test("monthly equivalents and totals per currency", () => {
  assert.equal(monthly(cost({ interval: "yearly", amount: 120 })), 10);
  assert.equal(monthly(cost({ interval: "quarterly", amount: 30 })), 10);
  assert.equal(monthly(cost({ interval: "once", amount: 30 })), 0);
  assert.deepEqual(monthlyTotals([cost({}), cost({ currency: "CHF", amount: 12, interval: "yearly" }), cost({ active: false })]), { USD: 25, CHF: 1 });
  assert.equal(moneyList({ CHF: 1234.5, USD: 0 }), "CHF 1’234.50");
});

test("amounts look the same in every browser (own thousands separator)", () => {
  assert.equal(amountText(0), "0.00");
  assert.equal(amountText(999.9), "999.90");
  assert.equal(amountText(1000), "1’000.00");
  assert.equal(amountText(1234567.891), "1’234’567.89");
  assert.equal(amountText("59.4"), "59.40");
});

test("renewals roll forward without drifting the day of the month", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(nextRenewal(cost({ next_due: "2026-01-31" }), "2026-03-01"), "2026-03-31"); // not the 28th
  assert.equal(nextRenewal(cost({ interval: "yearly", next_due: "2025-11-02" }), "2026-10-20"), "2026-11-02");
  assert.equal(nextRenewal(cost({ interval: "once", next_due: "2026-10-01" }), "2026-10-20"), null);
  assert.equal(nextRenewal(cost({ next_due: null }), "2026-10-20"), null);
});

test("recurring tasks: the next due date is never in the past", () => {
  assert.equal(nextDue("2026-10-20", "weekly", "2026-10-20"), "2026-10-27");
  assert.equal(nextDue("2026-09-01", "weekly", "2026-10-20"), "2026-10-27"); // done late: next free week
  assert.equal(nextDue("2026-08-01", "monthly", "2026-10-20"), "2026-11-01"); // done late: skips the missed months
  assert.equal(nextDue(null, "yearly", "2026-10-20"), "2027-10-20");
});

test("recurring tasks keep their day of the month (no drift at month ends)", () => {
  // MWST at every quarter end: anchor 31 → 31.3., 30.6., 30.9., 31.12. (was 30.12. when chained)
  const ends = ["2026-03-31"];
  for (let i = 0; i < 4; i++) ends.push(nextDue(ends.at(-1), "quarterly", ends.at(-1), 31));
  assert.deepEqual(ends, ["2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31", "2027-03-31"]);
  assert.equal(nextDue("2026-09-30", "quarterly", "2026-10-20", 31), "2026-12-31");
  assert.equal(nextDue("2026-09-30", "quarterly", "2026-10-20"), "2026-12-30"); // no anchor: the day of the date given
  // monthly from 31.1.: 28.2., then back to 31.3. (not 28.3.)
  assert.equal(nextDue("2026-01-31", "monthly", "2026-01-31"), "2026-02-28");
  assert.equal(nextDue("2026-02-28", "monthly", "2026-02-28", 31), "2026-03-31");
  assert.equal(nextDue("2028-02-29", "yearly", "2028-02-29"), "2029-02-28");
  assert.equal(nextDue("2029-02-28", "yearly", "2029-02-28", 29), "2030-02-28");
  assert.equal(nextDue("2031-02-28", "yearly", "2031-02-28", 29), "2032-02-29");
});

test("recurring task «Erledigt»: rolls forward, keeps its anchor; «einmalig» in the same edit closes it", () => {
  const item = { status: "next", repeat: "quarterly", due: "2026-09-30", repeat_day: 31 };
  assert.deepEqual(recurringDone(item, { status: "done" }, "2026-10-20", "T"), { status: "next", due: "2026-12-31", repeat_day: 31, last_done_at: "T", snoozed_until: null });
  assert.equal(recurringDone(item, { status: "done", repeat: null }, "2026-10-20"), null); // «einmalig» + «Erledigt»
  assert.equal(recurringDone({ ...item, repeat: null }, { status: "done", repeat: "monthly" }, "2026-10-20").due, "2026-10-31"); // made recurring in this edit
  assert.equal(recurringDone(item, { status: "done", due: "2026-10-15", repeat_day: 15 }, "2026-10-20").due, "2027-01-15"); // the edited date counts
  assert.equal(recurringDone({ ...item, status: "idea" }, { status: "done" }, "2026-10-20").status, "next");
  assert.equal(recurringDone({ ...item, status: "done" }, { status: "done" }, "2026-10-20"), null);
  assert.equal(recurringDone(item, { status: "doing" }, "2026-10-20"), null);
  assert.equal(recurringDone({ status: "next", repeat: "weekly", due: null }, { status: "done" }, "2026-10-20").repeat_day, null);
  assert.equal(recurringDone({ ...item, repeat_day: null }, { status: "done" }, "2026-10-20").repeat_day, 30); // derived once, then kept
});

test("what is due: open bills by date, renewal reminders only when their notice period starts", () => {
  const bills = [
    { payee: "Infomaniak", amount: 59.4, currency: "CHF", due_date: "2026-10-25", status: "open" },
    { payee: "Old", amount: 10, currency: "CHF", due_date: "2026-10-01", status: "paid" },
    { payee: "Notar", amount: null, currency: "CHF", due_date: null, status: "open", created_at: "2026-09-25T08:00:00Z" },
  ];
  const costs = [cost({ name: "Apple", interval: "yearly", next_due: "2026-11-15", notice_days: 30 }), cost({ name: "Domain", interval: "yearly", next_due: "2027-06-01", notice_days: 30 }),
    cost({ name: "Haftpflicht", interval: "yearly", next_due: "2026-12-22", notice_days: 60 })];
  const due = financeDue(costs, bills, "2026-10-20");
  // the bill without a due date: 30 days after it was entered (25.9. → 25.10.), marked as estimated
  assert.deepEqual(due.map((d) => [d.kind, d.row.payee ?? d.row.name, d.days, d.estimated ?? null]),
    [["bill", "Infomaniak", 5, false], ["bill", "Notar", 5, true], ["renewal", "Apple", 26, null], ["renewal", "Haftpflicht", 63, null]]);
  // reminder windows: Apple started 16.10. (→ today), Haftpflicht starts 23.10. (→ this week)
  assert.deepEqual(due.filter((d) => d.kind === "renewal").map((d) => d.remindFrom), ["2026-10-16", "2026-10-23"]);
});

test("«Behalten» (ack_until) hides the reminder for that renewal only", () => {
  const apple = cost({ name: "Apple", interval: "yearly", next_due: "2026-11-15", notice_days: 30 });
  assert.equal(financeDue([{ ...apple, ack_until: "2026-11-15" }], [], "2026-10-20").length, 0);
  assert.equal(financeDue([{ ...apple, ack_until: "2026-11-15" }], [], "2027-10-20").length, 1); // next year's renewal reminds again
  assert.equal(financeDue([{ ...apple, ack_until: "2025-11-15" }], [], "2026-10-20").length, 1);
});

test("bills without a due date: estimated from the Swiss day they were entered", () => {
  assert.deepEqual(billDue({ due_date: "2026-11-01" }, "2026-10-20"), { date: "2026-11-01", estimated: false });
  assert.deepEqual(billDue({ due_date: null, created_at: "2026-09-30T22:30:00Z" }, "2026-10-20"), { date: "2026-10-31", estimated: true }); // 1.10. in Zurich
  assert.deepEqual(billDue({ due_date: null }, "2026-10-20"), { date: "2026-11-19", estimated: true });
  assert.equal(zurichDay("2026-12-31T23:30:00Z"), "2027-01-01");
  assert.equal(zurichDay(null), "");
});

test("next 30 days: every renewal and open bill", () => {
  const up = upcoming([cost({ next_due: "2026-10-08" })], [{ payee: "X", amount: 5, currency: "CHF", due_date: "2026-11-01", status: "open" }], "2026-10-20");
  assert.deepEqual(up.map((u) => [u.kind, u.date]), [["bill", "2026-11-01"], ["renewal", "2026-11-08"]]);
});

test("next 30 days: renewals from the anchor (31.1. → 28.2. → 31.3.), a billed renewal counted once", () => {
  const c = cost({ id: "c1", next_due: "2026-01-31" });
  assert.deepEqual(upcoming([c], [], "2026-02-27", 40).map((u) => u.date), ["2026-02-28", "2026-03-31"]);
  const bill = { payee: "Supabase", amount: 25, currency: "USD", due_date: "2026-03-30", status: "open", cost_id: "c1" };
  assert.deepEqual(upcoming([c], [bill], "2026-02-27", 40).map((u) => [u.kind, u.date]), [["renewal", "2026-02-28"], ["bill", "2026-03-30"]]);
  // a paid bill or one of another cost changes nothing
  assert.equal(upcoming([c], [{ ...bill, status: "paid" }], "2026-02-27", 40).length, 2);
  assert.equal(upcoming([c], [{ ...bill, cost_id: "other" }], "2026-02-27", 40).length, 3);
});

test("CSV export: a period takes every bill by its booking day (paid → Swiss paid day, else due, else entered)", () => {
  assert.deepEqual(exportPeriod("year", "2026-10-20"), { from: "2026-01-01", to: "2026-12-31", label: "2026" });
  assert.deepEqual(exportPeriod("last-year", "2026-10-20"), { from: "2025-01-01", to: "2025-12-31", label: "2025" });
  assert.deepEqual(exportPeriod("all", "2026-10-20"), { from: null, to: null, label: "alle" });
  const paidNewYear = { status: "paid", paid_at: "2025-12-31T23:30:00Z", due_date: "2025-12-20" }; // 1.1.2026 in Zurich
  assert.equal(bookingDay(paidNewYear), "2026-01-01");
  assert.ok(inPeriod(paidNewYear, exportPeriod("year", "2026-10-20")));
  assert.ok(!inPeriod(paidNewYear, exportPeriod("last-year", "2026-10-20")));
  assert.equal(bookingDay({ status: "open", due_date: "2026-02-01", created_at: "2025-12-01T10:00:00Z" }), "2026-02-01");
  assert.equal(bookingDay({ status: "open", due_date: null, created_at: "2025-12-01T10:00:00Z" }), "2025-12-01");
  assert.ok(inPeriod({ status: "cancelled", due_date: "2019-05-01" }, exportPeriod("all", "2026-10-20")));
});

test("bill files: only what the bucket accepts", () => {
  assert.equal(billFileType({ type: "application/pdf", name: "r.pdf" }), "application/pdf");
  assert.equal(billFileType({ type: "", name: "IMG_0042.HEIC" }), "image/heic"); // some browsers give HEIC no type
  assert.equal(billFileType({ type: "image/webp", name: "x" }), "image/webp");
  assert.equal(billFileType({ type: "image/gif", name: "x.gif" }), null);
  assert.equal(billFileType({ type: "image/gif", name: "x.png" }), null); // the type wins over the name
  assert.equal(billFileType({ type: "", name: "notes.txt" }), null);
});

test("amounts typed the Swiss way", () => {
  assert.equal(parseAmount("1'234.50"), 1234.5);
  assert.equal(parseAmount("CHF 99.–"), 99);
  assert.equal(parseAmount("1 234,50"), 1234.5);
  assert.equal(parseAmount(""), null);
  assert.ok(Number.isNaN(parseAmount("abc")));
});

test("CSV: semicolons, quotes, no formulas", () => {
  const csv = toCsv(["Name", "Betrag"], [["Müller; AG", 10], ["=HYPERLINK(1)", 2], ["\t=1+1", 3], ["\r@SUM(A1)", 4], ["-Rabatt", 0]]);
  assert.ok(csv.startsWith("﻿Name;Betrag\r\n"));
  assert.match(csv, /"Müller; AG";10/);
  assert.match(csv, /"'=HYPERLINK\(1\)";2/);
  assert.match(csv, /"'\t=1\+1";3/);
  assert.match(csv, /"'\r@SUM\(A1\)";4/);
  assert.match(csv, /"'-Rabatt";0/);
  assert.match(toCsv(["n"], [[-5]]), /\r\n-5\r\n$/); // numbers stay numbers
});
