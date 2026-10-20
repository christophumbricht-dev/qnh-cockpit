-- QNH Core – Finanzen: receipts Christoph paid privately for the company (before the founding or later), which the
-- company pays back, plus net amount, VAT and how it was paid. Safe to run more than once. Needs 20261021100000_finance.sql.
--
--   paid_by        'firma' (the company paid) or 'privat' (Christoph paid it himself – the company owes it to him)
--   reimbursed_at  set when the company paid him back; open = paid_by 'privat' and reimbursed_at null
--   net, vat       from the receipt (amount stays the gross total)
--   paid_with      e.g. «Kreditkarte», «Twint»

alter table public.fin_bills add column if not exists paid_by text not null default 'firma'
  check (paid_by in ('firma', 'privat'));
alter table public.fin_bills add column if not exists reimbursed_at timestamptz;
alter table public.fin_bills add column if not exists net numeric(12, 2)
  check (net is null or (net >= 0 and net < 10000000));
alter table public.fin_bills add column if not exists vat numeric(12, 2)
  check (vat is null or (vat >= 0 and vat < 10000000));
alter table public.fin_bills add column if not exists paid_with text not null default ''
  check (char_length(paid_with) <= 60);

-- the same receipt cannot be entered twice (same payee and receipt number)
create unique index if not exists fin_bills_receipt_once on public.fin_bills (lower(payee), invoice_no) where invoice_no <> '';
