# Browser-to-UCP Cart Continuation — reference prototype

A reference prototype exploring **one candidate mechanism** against the requirements in
[Browser-to-UCP Cart Continuation — Problem Statement and Requirements v0.3](design/browser-to-ucp-cart-continuation-v0.3.md).

The mechanism explored is v0.3 alternative **D**, a verifier-bound continuation
exchange. v0.3 does not presume D is the right answer — it asks first whether
combinations of **A** (return `cart_id` directly), **B** (eager UCP cart
creation), **E** (Identity Linking) or **F** (stay inside WebMCP) make a new
continuation primitive unnecessary. This prototype does not argue that question;
it exists to test the feasibility and failure modes of D.

**NOT a UCP implementation. NOT a production security system.**

**Scope: cart only.** Checkout continuation is out of v1 scope (v0.3 §14) and is
deliberately absent here — not stubbed, not partially modeled. The single
successful continuation result is a UCP cart.

## Problem

An agent may already hold a merchant cart inside an authenticated browser
session — either merchant-native with no UCP identity, or an existing UCP cart
whose identifier isn't available outside the browser interaction. When the agent
leaves that browser context for another UCP transport, there is no standard,
credential-safe way to resolve that cart into an agent-addressable UCP cart.

The naive answer — hand the agent the session cookie — transfers far more
authority than the task needs. v0.3 states the gap precisely:

> How can an existing browser cart be handed off into an agent-addressable UCP
> cart without exporting browser credentials, turning a browser-visible value
> into an unrestricted reusable cart capability, or conflating cart continuity
> with buyer identity or transaction authority?

## WHAT IT DEMONSTRATES

Executable evidence for selected state-machine, concurrency and data-handling
properties:

| v0.3 | Property | Test |
| --- | --- | --- |
| R5 / case 1 | A merchant-native cart with no UCP id resolves to exactly one UCP cart | [continuation.test.ts](tests/continuation.test.ts) |
| R5 / case 2 | An existing UCP cart is preserved, not cloned | [continuation.test.ts](tests/continuation.test.ts) |
| R5 / Q6 | Multiple continuations for one native cart converge on one UCP cart | [continuation.test.ts](tests/continuation.test.ts) |
| R3 / case 4 | A stolen continuation without the verifier cannot be redeemed | [security.test.ts](tests/security.test.ts) |
| R3 | A wrong verifier fails, and does not consume the grant (anti-DoS) | [security.test.ts](tests/security.test.ts) |
| R4 / case 5 | Replay after a successful redemption fails | [security.test.ts](tests/security.test.ts) |
| R4 | An expired continuation fails | [security.test.ts](tests/security.test.ts) |
| R4 / case 6 | At most one redemption wins the consumption race | [concurrency.test.ts](tests/concurrency.test.ts) |
| R1 / case 3 | No browser credential appears in the grant, in storage, or in the result | [security.test.ts](tests/security.test.ts) |
| R1 | The merchant session identifier stays merchant/bridge-internal | [security.test.ts](tests/security.test.ts) |
| R8 / case 7 | A cart mutated after issuance resolves to live state at redemption | [continuation.test.ts](tests/continuation.test.ts) |
| R6 / cases 9–10 | No buyer identity, payment, checkout-completion or order authority | [security.test.ts](tests/security.test.ts) |
| R7 / case 8 | Account-private fields are omitted absent independent authorization | [security.test.ts](tests/security.test.ts) |
| R7 | The continuation alone never supplies that authorization | [security.test.ts](tests/security.test.ts) |

The single-winner guard is verified **meaningful** by mutation: the test drives 16
callers through `consume()`, and removing the guard makes it fail with 2 commits
rather than 1.

What the concurrency test proves is narrow: **at most one redemption wins the
continuation consumption race, and replay is rejected.** It does not prove that
consumption and cart resolution are transactionally atomic — see the limitation
below.

Also covered: a deleted cart yields `state_unavailable` with no stale recreation;
distinct failure predicates collapse to a single wire error.

## WHAT IT DOES NOT DEMONSTRATE

Everything below is a real limitation, not a to-do list.

**It does not solve privileged browser issuance.** `TrustedIssuanceBridge` is
simulated. v0.3 §4 is precise about the actual gap: WebMCP *does* distinguish a
browser agent from page JavaScript, and mediates tool invocation. What's missing
is an integrity-preserving primitive binding agent-generated challenge material
*through* the browser to merchant-side issuance while excluding page-JS
substitution. `SimulatedTrustedIssuanceBridge` enforces nothing: merely reaching
its `requestContinuation` stands in for the challenge having arrived through a
privileged context, and any in-process caller can reach it.

**The page-script rejection test demonstrates desired interface semantics, not an
enforceable security property.** v0.3 lists case 14 as "a requirements target,
not a claim that current WebMCP supplies the needed primitive." No XSS-resistance
claim is made or supported.

**It does not implement Platform authentication and does not satisfy R10.**
`SimulatedPlatformBinding` / `authenticatedPlatformProfile` carry a string the
merchant compares for equality. **String equality against a self-asserted profile
identifier does not satisfy R10** ("Verifiable Platform binding… a self-asserted
Platform profile URI alone is insufficient"). Actual UCP/A2A Platform-profile
binding is unresolved: per v0.3 §5, A2A authenticates a *client principal* and
`UCP-Agent` advertises a *claimed profile URI*, and the cryptographic mapping
between those two identities is undefined for this use case. The naming is
deliberate so the seam cannot be mistaken for production authentication.

**It does not settle the commerce/private-data boundary.** `DemoDisclosurePolicy`
is the prototype's own illustrative split, **not a claimed UCP rule**. v0.3
maintainer question C — "exactly which cart fields may cross this handoff without
Identity Linking or another independent buyer authorization" — needs a concrete
field-level answer that this prototype does not provide. What is tested is the
*mechanism*: fields are withheld unless an independent authorization signal is
supplied.

**It does not prove that independent authorization has been authenticated.**
`SimulatedIndependentAuthorization` is a caller-provided plain object carrying an
`unverifiedSubjectUserId`; nothing validates it, and any caller can assert any
value. The seam demonstrates **separation of authority only** — that
account-private disclosure turns on a signal established outside the
continuation, and that the continuation never produces one. It is not Identity
Linking and not authentication.

**It does not demonstrate transport independence (R9).** There is no REST, MCP,
or A2A binding — only in-process calls. v0.3 matrix cases 11 and 12 are
unexercised.

**It is not a UCP implementation.** `UcpCart` is a local shape, not a conformant
UCP resource.

**Grant consumption and cart resolution are not transactionally atomic in this
in-memory prototype.** A production implementation requiring retry after
merchant-side resolution failure would need an appropriate transactional
persistence boundary. The single-winner guarantee covers consumption only: it
ensures one winner of the consumption race, not that consumption and resolution
succeed or fail together.

**Storage is in-memory and single-process.** The single-winner argument holds for
this store; a real deployment needs the equivalent database guarantee (e.g.
`UPDATE … WHERE consumed_at IS NULL` plus an affected-row check).

**Revocation/session-termination semantics are intentionally not modeled in the
v0.3 prototype.** v0.3 does not require logout invalidation, so no replacement
revocation semantics are invented here.

**Constant-time comparison is partial.** `constantTimeEqual` short-circuits on
length mismatch, and lookups are ordinary hash-map reads.

**It implements no payments, Identity Linking, AP2, checkout completion, or order
placement** — by design, and asserted negatively by the R6 test.

## Architecture

```text
  Agent privileged context          Merchant                      UCP transport
  ────────────────────────          ────────                      ─────────────
  verifier = random()
  challenge = S256(verifier)
          │
          │  TrustedIssuanceBridge          ┌──────────────────┐
          │  (challenge, platform?)         │ BrowserSession   │
          ├────────────────────────────────▶│  sessionId    ✗  │
          │   ⚠ SIMULATED — v0.3 Q(A)       │  cartKey ────────┼──┐
          │   bound to the active session;  │  cookieValue  ✗  │  │ ✗ never
          │   takes NO session id           └──────────────────┘  │   crosses
          │                                                       │   (R1)
          │                                 ┌──────────────────┐  │
          │                                 │ ContinuationGrant│  │
          │                                 │  codeHash        │  │
          │                                 │  codeChallenge   │◀─┘
          │                                 │  stateKey        │
          │                                 │  platformProfile?│
          │                                 │  expiresAt       │
          │◀── continuation_code ───────────│  consumedAt?     │
          │                                 └──────────────────┘
          │
          │  code + verifier + ⚠ simulated platform binding
          ├───────────────────────────────────────────────────────────▶
          │                                 validate: expiry, unused,
          │                                 S256, ⚠ platform (NOT R10)
          │                                        │
          │                                 read LIVE native cart (R8)
          │                                        │
          │                                 ┌──────┴────────────────┐
          │                                 │ single-winner consume │
          │                                 │ then resolve          │
          │                                 │ (NOT one transaction) │
          │                                 └──────┬────────────────┘
          │                                        │ DemoDisclosurePolicy (R7)
          │◀── UcpCart (line items; private ───────┘
          │    fields only on independent
          │    authorization)
```

| Path | Role |
| --- | --- |
| [src/types.ts](src/types.ts) | Model, error codes, `TrustedIssuanceBridge`, `DemoDisclosurePolicy` |
| [src/crypto.ts](src/crypto.ts) | S256, code generation, constant-time compare |
| [src/merchant.ts](src/merchant.ts) | `issueContinuation` / `redeemContinuation` |
| [src/agent.ts](src/agent.ts) | Agent context, simulated bridge, `SimulatedPlatformBinding` |
| [src/continuation-store.ts](src/continuation-store.ts) | Grants; single-winner consume |
| [src/cart-store.ts](src/cart-store.ts) | Native carts; native→UCP association; `resolveCart` |

## What the code does enforce

- **No browser credential crosses** (R1). `BrowserSession.cookieValue` exists
  solely so a test can assert it never escapes.
- **No merchant session identifier crosses** (R1). `TrustedIssuanceBridge`
  represents an **already-bound active browser context**: it is constructed
  against a session and takes no session identifier on any method. The agent
  supplies challenge and platform material only, and its public issuance API has
  zero parameters besides options. Neither a browser cookie nor a merchant
  session id enters the agent-facing API. (`BrowserSession.sessionId` remains an
  internal merchant-side field.)
- **Verifier possession** (R3). PKCE S256; `plain` is not implemented. PKCE
  proves possession of the verifier corresponding to the challenge bound at
  issuance — not same-agent-instance identity.
- **Code is never stored.** Only `SHA-256(code)` is persisted.
- **Bounded replay** (R4). Single-use, expiry, and a single-winner consume.
- **Failures do not leak predicates.** Every security-sensitive failure surfaces
  as `invalid_continuation`; the specific reason lives in a non-wire
  `internalReason` field that exists only so tests can assert it.
- **Least authority** (R6). Redemption returns the resolved cart and nothing
  else — no capability grant, token or identity claim. The continuation's whole
  authority is to resolve the bound cart; it does not itself confer authority to
  perform subsequent UCP operations on that cart. No checkout, order or payment
  operation exists on the merchant surface.
- **Live cart at resolution** (R8), never an issuance-time snapshot.

Error surface: `invalid_request`, `invalid_continuation`, `state_unavailable`,
`temporarily_unavailable`.

## Relationship to UCP `continue_url`, Identity Linking and WebMCP

**`continue_url`** runs the other way — it hands off toward merchant/browser UI.
The reciprocal browser-cart → external-UCP direction is the undefined one.
Relatedly, UCP's **Permalink** rule already forbids browser-addressable URLs from
carrying session cookies, bearer tokens or one-time secrets; v0.3 reads that as
useful precedent rather than an obstacle, and it is why continuation material
needs its own mechanism instead of overloading Permalink.

**Identity Linking** authorizes a Platform to act for a user via OAuth, and may
let a merchant recover an *account-associated* cart — but it does not identify an
arbitrary current browser cart. It is also the natural source of the independent
authorization that R7 requires before account-private fields may cross, which is
exactly what this prototype withholds by default.

**WebMCP** already distinguishes a browser agent from page JavaScript and
mediates tool invocation — v0.2 framing that implied otherwise was wrong, and
v0.3 §4 corrects it. WebMCP is also alternative **F**: if a workflow never leaves
the browser, no continuation is needed at all. The open question is narrower than
"can WebMCP be trusted" — it is whether a browser primitive can integrity-bind
agent-generated challenge material to merchant issuance.

## Running

```bash
npm install --registry=https://registry.npmjs.org/
```

```bash
npm test
```

```bash
npx tsc --noEmit
```

### Results

`npm test` (vitest 2.1.9, Node v22.21.1):

```text
 ✓ tests/concurrency.test.ts (2 tests) 3ms
 ✓ tests/continuation.test.ts (6 tests) 4ms
 ✓ tests/security.test.ts (13 tests) 6ms

 Test Files  3 passed (3)
      Tests  21 passed (21)
```

`npx tsc --noEmit` (tsc 5.7.x, `strict` + `noUncheckedIndexedAccess` +
`exactOptionalPropertyTypes`): exit 0, no diagnostics.

## License

Apache License 2.0. See [LICENSE](LICENSE).
