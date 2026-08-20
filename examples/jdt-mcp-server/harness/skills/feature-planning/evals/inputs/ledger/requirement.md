# Ledger requirement

Implement a ledger with two responsibilities: validate a transfer against available balance, then
apply debit and credit atomically. A rejected transfer must leave all balances byte-for-byte
unchanged. Acceptance scenarios: a valid transfer moves the amount exactly once; an overdraft is
rejected without mutation. The project uses Node's built-in test runner.
