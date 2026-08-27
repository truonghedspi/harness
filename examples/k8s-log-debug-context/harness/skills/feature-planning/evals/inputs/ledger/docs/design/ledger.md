# Ledger design

Components: `TransferValidator` and `Ledger`.

| Id | Component | Invariant | Observable seam |
|---|---|---|---|
| `INV-LEDGER-1` | Ledger | A rejected transfer always leaves every balance unchanged | before/after `snapshot()` |
| `INV-LEDGER-2` | Ledger | A successful transfer always conserves the total balance | before/after `snapshot()` sum |

## Feature impact

| Feature | Impact | Reason |
|---|---|---|
| transfer validation | new | requirement names a separate responsibility |
| atomic application | new | requirement names a separate responsibility |
