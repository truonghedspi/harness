# Pseudocode dialect (Format A) — the canonical logic representation

Logic lives here, not in tables. A table cannot distinguish "run both, in sequence" from "choose one" — that ambiguity is exactly how an agent re-codes `a(); b();` into `if a return; if b return;`. This dialect makes control-flow composition explicit and machine-checkable.

**Hard rule: never represent logic as a rule-list.** Every relationship between steps must be one of: SEQUENCE (both/all run, ordered), SELECTION (exclusive — IF/SWITCH), PARALLEL (concurrent), ITERATION (LOOP/FOR). If steps run unconditionally one after another, wrap them in `SEQUENCE`.

## Grammar (line-oriented; indentation = nesting; 2 spaces per level)

```
FUNCTION name(args) -> ReturnType:
  <statement> | <block>
```

Blocks:
- Selection: `IF <cond> [BR-id]:` → `ELSE IF <cond> [BR-id]:` (0+) → `ELSE:` (required, use `ELSE: (continue)` if no-op)
- Multi-way: `SWITCH <expr> [BR-id]:` with `CASE <value>:` arms and a required `DEFAULT:`
- Iteration: `LOOP <cond> [BR-id]:` or `FOR <var> IN <coll> [BR-id]:`
- Unconditional group: `SEQUENCE [note]:` (ordered) or `PARALLEL [note]:` (concurrent)

Statements:
- Assignment / call: `x = expr` or `someCall(args)` — must end with an evidence tag
- External call: `x = CALL service.op(args)` or `CALL service.op(args) -> x` — the result `x` MUST be consumed by a later branch, or explicitly `IGNORE x`
- Event: `PUBLISH "topic"(payload) [SIDE-EFFECT: async]` / `CONSUME "topic" -> x`
- State: annotate with `[STATE: from->to]`
- Outcomes: `RETURN <expr> [OUT-id]` / `RAISE <Error> [OUT-id: error]`

## Tags
- `[BR-xxx]` on every condition (IF / ELSE IF / SWITCH / LOOP / FOR). These IDs are what test cases reference.
- `[OUT-x]` on every RETURN / RAISE (terminal outcomes).
- Evidence on every condition and side-effect line: `[src: path:Lnn]`, `[doc: …]`, `[db: …]`, `[cfg: …]`, `[mq: …]`. If unknown: `[ASSUMED: basis]` or `[?]` — and add a matching entry in §15.
- Faithful-vs-incidental (for "sát code" migration): mark `[INTENT]` for deliberate business logic, `[INCIDENTAL]` or `[?BUG]` for implementation quirks you suspect shouldn't be replicated. Prevents migrating bugs blindly.

## Worked example
```pseudocode
FUNCTION checkout(req) -> Response:
  cart = cartRepo.load(req.cartId)                        // [src: CheckoutService.kt:L10]
  IF cart.items is empty [BR-001]:                         // [src: CheckoutService.kt:L11]
    RETURN Response(400, EMPTY_CART) [OUT-1]
  ELSE: (continue)
  SEQUENCE [both always run, unconditional]:               // prevents rule-list misread
    applyTax(cart)                                         // [src: CheckoutService.kt:L14]
    applyLoyaltyPoints(cart)                               // [src: CheckoutService.kt:L15]
  charge = CALL payment.charge(cart.total)                 // [src: CheckoutService.kt:L17]
  SWITCH charge.status [BR-002]:                           // [src: CheckoutService.kt:L18]
    CASE OK:
      order.status = PAID [STATE: *->PAID]                 // [src: CheckoutService.kt:L20]
      PUBLISH "order.paid"(order.id) [SIDE-EFFECT: async]  // [mq: CheckoutService.kt:L21]
    CASE DECLINED:
      RETURN Response(402, DECLINED) [OUT-2]               // [src: CheckoutService.kt:L24]
    DEFAULT:
      RAISE PaymentException(charge.status) [OUT-3: error] // [src: CheckoutService.kt:L26]
  RETURN Response(200, order) [OUT-4]                      // [src: CheckoutService.kt:L29]
```

## Cross-service
Keep each service's logic in its own `FUNCTION`. Represent a synchronous hop as `x = CALL otherSvc.op(...)` and an asynchronous hop as `PUBLISH "topic"` / `CONSUME "topic"`. The *orchestration shape* across services is shown additionally as a BPMN/Mermaid companion (see template §14) whose gateways must agree with the pseudocode branches.

## Lint (mandatory — `scripts/lint_pseudocode.py`)
Run before emitting the document. **Errors block output.** Rules:
1. Every `IF`/`ELSE IF` chain ends in an explicit `ELSE`.
2. Every `SWITCH` has a `DEFAULT`.
3. Every `IF`/`ELSE IF`/`SWITCH`/`LOOP`/`FOR` carries a `[BR-xxx]`.
4. Every `RETURN`/`RAISE` carries an `[OUT-x]`.
5. Every condition and side-effect line carries an evidence tag (or `[ASSUMED]`/`[?]`).
6. Every `CALL` result is consumed by a later branch or explicitly `IGNORE`d (so no external-call failure path is silently dropped).
7. No duplicate `[BR-]` / `[OUT-]` ids.
8. (Optional) `--expected-branches N`: the count of `[BR-]` tags must equal the number of conditionals counted during mechanical extraction — this is the reconciliation gate.

Advisory warning (non-blocking): 2+ consecutive side-effect statements at function-body level not wrapped in `SEQUENCE`/`PARALLEL` — confirm they truly run unconditionally.

Usage:
```bash
python scripts/lint_pseudocode.py <spec-or-pseudocode-file> --expected-branches <N>
```
