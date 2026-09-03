# A fixture that writes fragments concurrently will implicate the subject itself

## Observe

The TCON-SHIM-0001 oracle measures a property of stdout: every line must be exactly one MCP message. To
Setting up the "message interrupted between two writes" hazard, the daemon side of the fixture writes each response
do three separate writes, with `setTimeout` in between. The first version processes each received line right in
handler `data`, so the three responses run on top of each other and their bytes mix on the socket.

Result: red shift with "host: 1, joiner: 1" after 30 seconds of waiting, looks like a shim INV-SHIM-1 violation.
In fact, shim does the right thing — it receives a concatenated line from three different messages, finds it cannot be parsed, and
switch to stderr. The error lies in the fixture.

## Evidence

After queuing the fixture and recording EACH message completely (still keeping three separate writes for
per message), shift green immediately. The hazard remains intact: the mutant removes the frame according to the newline in `attach()` still
does the red shift, and so does the mutant that removes the blocking port `isMcpMessage`.

Correct boundaries: a message is allowed to be interrupted across multiple writes (that's the subject's hazard),
but TWO messages are not allowed to mix bytes (that's the writer's fault, not the shim's). Mix two
message is something a real daemon would never do, so this statement is because it is what we are talking about
fixture.

## Rules for next time

When a fixture is intentionally left unfinished to create hazard framing, always serialize each message. And when
A new oracle red the first run on the source code is `done`, reading the error message to distinguish the two
possibility before concluding: the subject is wrong, or the fixture itself has created input that the spec does not allow
exists.