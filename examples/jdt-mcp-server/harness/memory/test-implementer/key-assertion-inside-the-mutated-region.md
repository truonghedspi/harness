# A synchronization barrier inside the mutated region must be order-neutral

**When to apply:** oracle targets a mutant like REVERSE THE ORDER of two statements, and the fixture needs to stop the program
Correctly resubmit between those two statements. Found in `feat-prove-evict-success` (mutant N1: `spawned.stop()`
run before `#runDetachments(victim)` in `#evict`).

## Trap

The most natural way to build a race window is to put a deferred inside one of the two statements — here
The fake spawner's `stop()` signals `stopReached` and then waits for `stopGate`. But the statement itself is
the mutant thing moves. Result: `stopReached` fires at two DIFFERENT times between the original code and the mutant.
On the original code, by the time it plays `forget()` has already run; Under mutant, `forget()` is not running yet.

If the rest of the fixture assumes "when the latch is open then X has occurred", the fixture is encoding the correct one
the order in which it must judge. It will be green or red for a reason other than the one being named.

## Correct way

Once the block is open, only do things that are legal in BOTH orders — in this case, process spawning
Successor then publish a notification. Only AFFIRMATION distinguishes the two orders, and it only
is read the status AFTER the evict turn is completely completed (`await` the promise `acquire` has started
evict dynamic — it is the only synchronization point that is true in both orders).

Signs of doing it right: between the original code and the mutant, there is only ONE line that confirms the result; every anchor
The previous poplar is still green under the mutant. If the positive anchor is also red, the red turn comes from the scene setting stage
not from behavior, and the evidence cannot be used.

## Attached

The second acquire call itself may entail an extra evict pass (where it pushes cap to 4 and evict
`beta`). The secondary victim must stop NOW, or the fixture will lock itself out. First generation only
of the root under investigation will be stopped slowly.