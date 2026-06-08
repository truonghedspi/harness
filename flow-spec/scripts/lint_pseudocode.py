#!/usr/bin/env python3
"""
lint_pseudocode.py — enforce the Flow Spec pseudocode dialect (Format A).

ERRORS block output (exit code 1). WARNINGS are advisory (exit 0 if no errors).

Usage:
    python lint_pseudocode.py <file> [--expected-branches N] [--indent 2]

The file may be Markdown (fenced ```pseudo / ```pseudocode blocks are extracted
and linted together) or a raw pseudocode file (linted as-is).

Dialect (line-oriented, indentation = nesting):
    FUNCTION name(args) -> Type:
    IF <cond> [BR-xxx]:        / ELSE IF <cond> [BR-yyy]:  / ELSE: [(continue)]
    SWITCH <expr> [BR-xxx]:    / CASE <val>:               / DEFAULT:
    LOOP <cond> [BR-xxx]:      / FOR <...> [BR-xxx]:
    SEQUENCE [note]:           / PARALLEL [note]:
    x = CALL target(...)       / CALL target(...) -> x      / IGNORE x
    PUBLISH ...                / RETURN ... [OUT-x]          / RAISE ... [OUT-x]
Evidence tag = one of [src: [doc: [db: [cfg: [mq: , or [ASSUMED / [? (routes to §15).
"""
import re
import sys
import argparse

EVIDENCE_RE = re.compile(r"\[(src|doc|db|cfg|mq|ASSUMED|\?)", re.IGNORECASE)
BR_RE = re.compile(r"\[BR-[A-Za-z0-9_]+\]")
OUT_RE = re.compile(r"\[OUT-[A-Za-z0-9_]+")
ALL_BR_RE = re.compile(r"\[(BR-[A-Za-z0-9_]+)\]")
ALL_OUT_RE = re.compile(r"\[(OUT-[A-Za-z0-9_]+)")


def extract_pseudocode(text):
    """Pull fenced ```pseudo* blocks; if none, return the whole text."""
    blocks = re.findall(r"```(?:pseudo\w*)\n(.*?)```", text, re.DOTALL)
    if blocks:
        return "\n".join(blocks)
    if "```" in text:  # there are code fences but none tagged pseudo -> ambiguous
        # fall back to any fenced block only if exactly one, else whole text
        generic = re.findall(r"```\w*\n(.*?)```", text, re.DOTALL)
        if len(generic) == 1:
            return generic[0]
    return text


def strip_comment(line):
    # comments start with // ; keep tags that live before // intact
    idx = line.find("//")
    return line if idx == -1 else line[:idx]


def classify(stripped):
    s = stripped
    if s.startswith("FUNCTION"):
        return "FUNCTION"
    if s.startswith("ELSE IF"):
        return "ELSE_IF"
    if s.startswith("ELSE"):
        return "ELSE"
    if s.startswith("IF "):
        return "IF"
    if s.startswith("SWITCH"):
        return "SWITCH"
    if s.startswith("CASE"):
        return "CASE"
    if s.startswith("DEFAULT"):
        return "DEFAULT"
    if s.startswith("LOOP"):
        return "LOOP"
    if s.startswith("FOR "):
        return "FOR"
    if s.startswith("SEQUENCE"):
        return "SEQUENCE"
    if s.startswith("PARALLEL"):
        return "PARALLEL"
    if s.startswith("RETURN"):
        return "RETURN"
    if s.startswith("RAISE"):
        return "RAISE"
    if s.startswith("PUBLISH"):
        return "PUBLISH"
    if s.startswith("IGNORE"):
        return "IGNORE"
    if "CALL" in s:
        return "CALL"
    return "OTHER"


def indent_of(raw):
    return len(raw) - len(raw.lstrip(" "))


class Line:
    def __init__(self, no, indent, kw, full, code):
        self.no = no
        self.indent = indent
        self.kw = kw
        self.full = full      # original incl comment (for evidence/tag checks)
        self.code = code      # comment stripped
        self.parent = None


def parse(pseudocode):
    lines = []
    for i, raw in enumerate(pseudocode.splitlines(), start=1):
        if not raw.strip():
            continue
        code = strip_comment(raw).rstrip()
        if not code.strip():
            # comment-only line; skip structurally
            continue
        ind = indent_of(code)
        kw = classify(code.strip())
        lines.append(Line(i, ind, kw, raw.strip(), code.strip()))
    # assign parents: nearest previous line with strictly smaller indent
    stack = []  # (indent, Line)
    for ln in lines:
        while stack and stack[-1][0] >= ln.indent:
            stack.pop()
        ln.parent = stack[-1][1] if stack else None
        stack.append((ln.indent, ln))
    return lines


def lint(pseudocode, expected_branches=None):
    errors, warnings = [], []
    lines = parse(pseudocode)
    if not lines:
        errors.append("No pseudocode found to lint.")
        return errors, warnings

    # group by parent for sibling-order checks
    groups = {}
    for ln in lines:
        groups.setdefault(id(ln.parent), []).append(ln)

    # Rule 1: every IF / ELSE_IF chain terminates in an ELSE
    for sibs in groups.values():
        n = len(sibs)
        i = 0
        while i < n:
            if sibs[i].kw in ("IF", "ELSE_IF"):
                # walk the chain forward
                j = i
                closed = False
                while j < n and sibs[j].kw in ("IF", "ELSE_IF", "ELSE"):
                    if sibs[j].kw == "ELSE":
                        closed = True
                        break
                    j += 1
                    if j < n and sibs[j].kw not in ("ELSE_IF", "ELSE"):
                        break
                if not closed:
                    errors.append(
                        f"L{sibs[i].no}: IF/ELSE-IF chain has no terminating ELSE "
                        f"-> '{sibs[i].code[:50]}'")
                i = j + 1
            else:
                i += 1

    # Rule 2: every SWITCH has a DEFAULT child
    for ln in lines:
        if ln.kw == "SWITCH":
            children = [x for x in lines if x.parent is ln]
            if not any(c.kw == "DEFAULT" for c in children):
                errors.append(f"L{ln.no}: SWITCH has no DEFAULT -> '{ln.code[:50]}'")
            if not any(c.kw == "CASE" for c in children):
                warnings.append(f"L{ln.no}: SWITCH has no CASE arms -> '{ln.code[:50]}'")

    # Rule 3: control-condition lines carry a [BR-xxx] tag
    for ln in lines:
        if ln.kw in ("IF", "ELSE_IF", "SWITCH", "LOOP", "FOR"):
            if not BR_RE.search(ln.full):
                errors.append(f"L{ln.no}: missing [BR-xxx] on {ln.kw} -> '{ln.code[:50]}'")

    # Rule 4: terminals carry an [OUT-x] tag
    for ln in lines:
        if ln.kw in ("RETURN", "RAISE"):
            if not OUT_RE.search(ln.full):
                errors.append(f"L{ln.no}: missing [OUT-x] on {ln.kw} -> '{ln.code[:50]}'")

    # Rule 5: evidence on condition + side-effect lines
    need_evidence = ("IF", "ELSE_IF", "SWITCH", "LOOP", "FOR",
                     "CALL", "PUBLISH", "OTHER")
    for ln in lines:
        if ln.kw in need_evidence:
            if not EVIDENCE_RE.search(ln.full):
                errors.append(
                    f"L{ln.no}: no evidence tag ([src/doc/db/cfg/mq] or [ASSUMED]) "
                    f"-> '{ln.code[:50]}'")

    # Rule 6: every CALL result is consumed by a later branch or explicitly IGNORE'd
    for idx, ln in enumerate(lines):
        if ln.kw == "CALL":
            var = None
            m = re.search(r"->\s*([A-Za-z_]\w*)", ln.code)
            if m:
                var = m.group(1)
            else:
                m = re.match(r"([A-Za-z_]\w*)\s*=\s*.*CALL", ln.code)
                if m:
                    var = m.group(1)
            if not var:
                warnings.append(
                    f"L{ln.no}: CALL result not bound to a variable -> '{ln.code[:50]}'")
                continue
            wb = re.compile(r"\b" + re.escape(var) + r"\b")
            consumed = False
            for later in lines[idx + 1:]:
                if later.kw in ("IF", "ELSE_IF", "SWITCH", "LOOP", "FOR") and wb.search(later.code):
                    consumed = True
                    break
                if later.kw == "IGNORE" and wb.search(later.code):
                    consumed = True
                    break
            if not consumed:
                errors.append(
                    f"L{ln.no}: CALL result '{var}' is never consumed by a branch "
                    f"(add a branch on it or 'IGNORE {var}') -> '{ln.code[:50]}'")

    # Rule 7: duplicate IDs
    def dupes(rx):
        seen, dup = set(), set()
        for ln in lines:
            for m in rx.finditer(ln.full):
                key = m.group(1)
                if key in seen:
                    dup.add(key)
                seen.add(key)
        return seen, dup

    br_ids, br_dup = dupes(ALL_BR_RE)
    out_ids, out_dup = dupes(ALL_OUT_RE)
    for d in sorted(br_dup):
        errors.append(f"Duplicate branch id [{d}]")
    for d in sorted(out_dup):
        errors.append(f"Duplicate outcome id [{d}]")

    # Rule 8 (optional): branch count reconciliation
    if expected_branches is not None:
        if len(br_ids) != expected_branches:
            errors.append(
                f"Branch reconciliation FAILED: {len(br_ids)} [BR-] tags in pseudocode "
                f"but {expected_branches} branches were counted in source. "
                f"Missing/extra branch(es) -> investigate.")

    # Advisory: unwrapped consecutive side-effect statements (the rule-list bug)
    for sibs in groups.values():
        run = []
        for ln in sibs + [None]:
            # only flag flat runs at function-body level; inside a chosen branch
            # (CASE/IF/ELSE/LOOP body) sequential execution is unambiguous.
            at_func_level = ln is not None and (ln.parent is None or ln.parent.kw == "FUNCTION")
            if ln is not None and ln.kw in ("OTHER", "CALL", "PUBLISH") and at_func_level:
                run.append(ln)
            else:
                if len(run) >= 2:
                    warnings.append(
                        f"L{run[0].no}-L{run[-1].no}: {len(run)} consecutive side-effect "
                        f"statements not wrapped in SEQUENCE/PARALLEL — confirm they run "
                        f"unconditionally (prevents 'rule-list' misreading).")
                run = []

    return errors, warnings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--expected-branches", type=int, default=None)
    ap.add_argument("--indent", type=int, default=2, help="(informational)")
    args = ap.parse_args()

    with open(args.file, "r", encoding="utf-8") as f:
        text = f.read()
    pseudocode = extract_pseudocode(text)
    errors, warnings = lint(pseudocode, args.expected_branches)

    for w in warnings:
        print(f"  WARN  {w}")
    for e in errors:
        print(f" ERROR {e}")

    if errors:
        print(f"\nLINT FAILED: {len(errors)} error(s), {len(warnings)} warning(s). "
              f"Output is BLOCKED until errors are fixed.")
        sys.exit(1)
    print(f"\nLINT PASSED: 0 errors, {len(warnings)} warning(s).")
    sys.exit(0)


if __name__ == "__main__":
    main()
