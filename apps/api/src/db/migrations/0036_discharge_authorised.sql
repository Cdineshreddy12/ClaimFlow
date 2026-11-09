-- The final bill goes to the insurer and two different things come
-- back: permission to discharge the patient, which IRDAI gives them
-- three hours for, and the money, which takes weeks and which no
-- regulation times.
--
-- With only SETTLED available after FINAL_BILL_SUBMITTED, turnaround
-- measured the gap to payment against the three-hour window and
-- reported every insurer at 100% past target on averages of five to
-- seven hundred hours. The number was a wait for a bank transfer
-- wearing the label of a patient waiting on a bed.
--
-- Added alone, in its own migration, because Postgres will not let a
-- new enum value be used in the transaction that adds it, and the
-- runner wraps one transaction per file.
alter type "claim_status" add value if not exists 'DISCHARGE_AUTHORISED'
  after 'FINAL_BILL_SUBMITTED';
