# UTF-8 character cutoffs must be justified in bytes, not declared in comments

**When applicable:** test cases need to distinguish `StringDecoder` from `chunk.toString("utf8")`, or
any case that claims "data is cut off in a difficult place". Encountered in `feat-mcp-shim`, mutant `D1` survived two
consecutive turns.

## Why is the old case harmless even though it looks very convincing?

The old framing case had the comment "a non-ASCII identifier straddling the chunk boundaries" and the fixture was full
multibyte characters. But the division is `Math.ceil(length / 7)` on **string index**, and the other way around
split in 30,000-byte steps with a 42-byte JSON prefix — every boundary falls at the beginning of a character.
When all boundaries are character boundaries, the two decoders output the **same string**, so the mutant lives.

Lesson: fixture *contains* multibyte characters that prove nothing. What needs to be proven is **the boundary lies
inside a character**, and that can be checked with a bit comparison:

```ts
const cut = buffer.indexOf(Buffer.from("𝄞", "utf8")) + 1;
assert.equal((buffer[cut] as number) & 0xc0, 0x80); // byte continuation ⇒ cut between characters
```

Choose a 4-byte character to have three continuation bytes stuck in the decoder, instead of one.

## Cutting in the right place is not enough: we must prove that the incoming chunk is read twice

On sockets, the test writer **doesn't** get to choose the read boundary: the kernel bundles many small `write()`s
into one `read()`, and with `PassThrough`, `Readable.read()` also concatenates the chunks in
buffer. buffer. Recording twice in a row and then believing that the other party saw two chunks is an unwarranted assumption
proof — exactly the kind of assumption that ruined the old case.

Proof that can be used in both directions:

1. Concatenate an **anchor message** (a complete line, with `\n`) into *the same write* with the missing beginning
   cut. Framer processes an entire chunk in a single `push()` call, so the anchor message is seen in the output
   meaning the header is already in the decoder — mechanical proof, not `setTimeout`.
2. Write only the tail **after** the anchor message has arrived, plus a ~100 ms delay. Settling interval
   Node type is the case where the kernel separates the first chunk and then delivers the first part.
3. Compare the **full text** received string with the original. "Parse into JSON" is an empty assertion
   Here: `chunk.toString()` on the character cutoff point produces `����` in a string value, JSON
   still valid — correct worst case scenario, no throw, no red, just silently false.

Includes a nice little utility: comparing two 200 KB strings with `assert.equal` prints a meaningless block;
The separate comparison function reports **the first offset character index** and the 24 surrounding characters so it can be read immediately.

## Oracle's own Framer cannot be broken

This case also hides a reverse trap: the daemon side in the test automatically assembles the chunks with `chunk.toString("utf8")`. When
shim writes a 200 KB line in one `write()` pass, the kernel returns according to its boundary, and a
Borders falling between characters will break **what oracle measures**, not what it tests. Chunk assembler
of test must use `StringDecoder` before saying anything about byte-exact.

## Signs that you've done enough

Mutant changes `StringDecoder` to `toString()` must be red in **each dimension independently** (measured separately
with a temporary spec that only holds one direction), and the red line must state the offset character index, not a timeout.