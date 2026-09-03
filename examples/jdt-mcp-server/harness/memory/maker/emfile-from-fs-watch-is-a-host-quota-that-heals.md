# `EMFILE` from `fs.watch()` is the host's quota, and it heals itself

**Context.** `feat-prove-diagnostics`, attempt 2 (2026-08-24) and attempt 3 (2026-08-25).

## Symptoms

Oracle's main feature is green 3/3 in 10.6 s, but `./harness/init.sh` is red. The red case is inside
`DiskFileSyncWatcher` and report `EMFILE` from `fs.watch()`. This shape invites two false conclusions:
The watcher leaks the descriptor file over many calls, or the test process exhausts the fd according to the throughput quota
usually.

## How to differentiate, only takes one command

Run a Node process **independently, without importing any modules from the project**, then measure the three things in the same
run times:

1. `fs.watch()` a newly created, empty temp directory;
2. `fs.watch()` a single file;
3. Open about 300 regular `/dev/null` file descriptors.

Attempt 2 measures: side 1 is red, side 2 and side 3 are blue. Those three results simultaneously refute both hypotheses
source code. An empty directory has nothing for the watcher to leak; file tracking and fd opening usually still have room to spare,
so what's shallow is not the general fd quota but the host's **directory tracking** quota. No
What changes in `src/` or `test/` justify it, and which is the right reason to keep `readyForCheck`
in `false` instead of haphazardly patching.

## It's not obvious

This quota is **self-freeing**. Attempt 3 ran the same diagnostic command again a day later: the whole directory
empty temp, repo folder, and 200 new subfolders are all traceable, not once `EMFILE`. Oracle
still 3/3 in 10.64 s and the baseline is up 124/124 without anyone editing a single line.

The root cause is multiple test processes running in parallel in the same session (multiple makers and checkers
working on different features simultaneously) exhausts macOS's quota at that exact moment.
When those processes end, the quota returns.

## Pull out

- `EMFILE` from `fs.watch()` on macOS is a **machine load signal**, not a code signal.
  Don't waste a retry trying to patch the watcher.
- Before blaming the watcher, always run the control in an independent process. If a process
  Not importing anything is red, the defect is outside the repo by definition.
- Baseline is red because of the environment, the correct option is to clearly write the diagnosis in `checkerNotes`, keep
  `readyForCheck: false`, then **measure again later** — no need to scale the test case to fit.
- Consequences for the retry budget: a "retry only" still counts as an attempt. Here it is spent
  last turn (3/3), so measure again when the machine is idle, don't measure while there are many testing processes
  other is running.