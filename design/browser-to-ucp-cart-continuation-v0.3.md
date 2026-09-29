# Browser-to-UCP Cart Continuation — Problem Statement and Requirements v0.3

**Status:** Problem Statement + Interoperability/Security Requirements
**Scope:** Cart only
**Not a normative UCP proposal**

This document identifies an interoperability gap, states requirements for any solution, and compares plausible approaches. It intentionally does not specify a finished protocol or browser API.

Requirements R1–R10 are design requirements, not RFC 2119 normative UCP language.

## 1. Problem statement

An agent may already be operating with a merchant cart inside an authenticated browser session. That cart may be:

* a merchant-native cart with no UCP identity; or
* an existing UCP cart whose identifier is not available outside the browser interaction.

When the agent leaves that browser context and continues through another UCP transport, it lacks a standard, credential-safe mechanism to obtain or resolve an **agent-addressable UCP cart corresponding to the existing merchant browser cart**.

The narrow gap is therefore:

> How can an existing browser cart be handed off into an agent-addressable UCP cart without exporting browser credentials, turning a browser-visible value into an unrestricted reusable cart capability, or conflating cart continuity with buyer identity or transaction authority?

Checkout continuation is outside v1 scope.

## 2. Existing UCP context

### Cart

**[Existing UCP]** UCP defines a Cart capability with create, get, update, and cancel operations. A cart has an `id`; `continue_url` supports cart handoff/session recovery.

The missing operation is not ordinary cart CRUD. It is resolving an already-existing **browser-side merchant cart** into the UCP cart namespace when the agent crosses out of that browser context.

### `continue_url`

**[Existing UCP]** Cart `continue_url` provides handoff toward merchant/browser UI. It does not define the reciprocal browser-cart → external-UCP handoff.

### Permalink

**[Existing UCP]** Current UCP deliberately prevents browser-addressable URLs from becoming secret carriers:

> “Permalinks MUST NOT contain payment credentials, payment instrument tokens, customer access tokens, session cookies, AP2 mandates, API keys, bearer tokens, or one-time secrets.”

That is useful precedent, not an obstacle: UCP already avoids carrying credentials and one-time secrets in browser-addressable URLs. A browser→agent cart handoff therefore needs a separate safe mechanism rather than overloading Permalink.

### Identity Linking

**[Existing UCP]** Identity Linking authorizes a Platform to act for a user using OAuth. It separately defines PKCE S256 for authorization-code exchanges.

Identity Linking may enable a merchant to recover an account-associated cart, but it does not itself define how an arbitrary current browser cart becomes the UCP cart the agent should address.

## 3. Authority separation

A cart-continuation mechanism, if introduced, should represent narrowly limited authority:

> resolve at most one merchant cart into the corresponding agent-addressable UCP cart.

It is not sufficient authority to:

* authenticate the buyer;
* establish Identity Linking;
* grant general account access;
* authorize payment;
* authorize checkout completion;
* authorize order placement; or
* transfer browser-session authority.

Successful handoff can disclose cart contents and related commerce state. Continuation material therefore requires confidentiality and privacy treatment even when it is not itself a browser credential.

## 4. Browser trust boundary

Current WebMCP **does** distinguish a browser agent from page JavaScript.

The WebMCP model permits agents built into the browser, while page tools are registered through `document.modelContext`; tool invocation is mediated by the browser and executes the page-provided tool callback.

The remaining requirement is narrower:

> Current WebMCP does not define an integrity-preserving primitive that binds agent-generated secret/challenge material through the browser to merchant-side continuation issuance while excluding arbitrary page JavaScript from substituting that material.

Therefore:

* ordinary page JavaScript may advertise continuation availability or participate in UX;
* page-provided tools may initiate merchant operations;
* but page JavaScript alone cannot serve as evidence that particular challenge/secret material originated with the legitimate browser agent.

The exact browser primitive needed for that integrity binding is an open **cross-standard/browser design question**.

No XSS-resistance claim should be made unless such a privileged binding actually exists.

## 5. Platform identity across transports

Platform binding and buyer identity are separate concerns.

UCP profiles serve both capability negotiation and identity/key publication, and UCP supports established authentication mechanisms rather than requiring a continuation-specific identity system.

### REST and MCP over streamable HTTP

For REST and MCP over streamable HTTP, existing UCP HTTP Message Signatures can
satisfy R10 without a continuation-specific identity mechanism. The request carries
`UCP-Agent: profile="..."`; that header is covered by the RFC 9421 signature, and
the signature's `keyid` resolves against the `keys[]` published by that profile.

A Platform-bound continuation can therefore record the intended profile URL at
issuance and require redemption through a signed UCP request whose verified
profile URL is the same one. The profile value supplied at issuance identifies
the permitted redeemer; cryptographic proof occurs at redemption.

This document does not introduce another signature or proof mechanism for those
transports.

### A2A specifically

A2A is **not unauthenticated**.

A2A Agent Cards declare supported security schemes and requirements; authentication uses established transport/web security mechanisms.

Separately, current UCP A2A requires the shopping Platform to advertise its UCP profile URI using `UCP-Agent`.

Those are two distinct facts:

```text
A2A authentication
    -> which authenticated client principal made the request

UCP-Agent profile URI
    -> which UCP Platform profile the request claims
```

The current UCP A2A text reviewed here does not define, for this use case, how the authenticated A2A client principal is cryptographically bound to the claimed UCP Platform profile URI.

That is an interoperability question, not evidence that A2A is unusable.

Any cart-continuation design that binds redemption to a Platform needs a verifiable relationship between those identities rather than trusting a self-asserted profile URI.

## 6. Alternatives analysis

| Alternative                                     | What it solves                                                                                                          | What it does not solve                                                                                                                         | When continuation is justified                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **A. Return `cart_id` directly**                | Minimal handoff when the browser cart already is a UCP cart and ordinary UCP authorization is sufficient to access it   | Merchant-native carts; safe delivery of the ID; cases where knowledge of the ID itself acts as meaningful cart capability                      | Possibly unnecessary if a trusted browser→agent channel can safely return an already-existing, properly protected UCP cart ID |
| **B. Eagerly create a UCP cart during handoff** | Converts merchant-native state to a UCP resource before leaving the browser                                             | Still needs a secure way to associate/deliver that resource to the external agent; may create resources that are never used                    | Useful if eager materialization is cheap and a trustworthy handoff channel exists                                             |
| **C. Short-lived bearer cart handle**           | Decouples internal merchant state from exposed cart IDs; easy to implement                                              | Interception: whoever obtains the handle first can redeem it; single-use limits replay but not first-use theft                                 | Adequate only if another layer already guarantees confidential, authenticated delivery; otherwise fails R3                    |
| **D. Verifier-bound continuation exchange**     | Makes interception of the continuation artifact alone insufficient; can support single-use and deferred cart resolution | Requires an integrity-preserving way to bind the verifier/challenge at browser issuance; still needs Platform authentication if Platform-bound | Justified if direct cart-ID handoff cannot satisfy the security boundary and the browser binding problem can be solved        |
| **E. Identity Linking**                         | Establishes user authorization and can enable account-backed cart retrieval                                             | Does not identify an arbitrary current browser cart; introduces buyer identity where cart continuation may not require it                      | May eliminate the need for continuation for carts that are already durably account-associated                                 |
| **F. Stay entirely inside WebMCP**              | Reuses the live browser's state/auth and avoids crossing the boundary                                                   | Does not support workflows that intentionally continue over REST/MCP/A2A or another external UCP transport                                     | No continuation mechanism is needed if the workflow never leaves the browser context                                          |

No alternative is presumed to be the final design.

The first maintainer question should be whether combinations of A, B, E, or F cover enough real workflows that a new continuation primitive is unnecessary.

## 7. Minimal interoperability and security requirements

Any proposed solution should satisfy all of the following.

**R1 — Browser credential isolation**
Browser cookies, session credentials, and equivalent browser authentication material never leave the browser/session boundary.

**R2 — No reusable browser-visible cart capability**
A browser-visible continuation artifact alone cannot become an unrestricted reusable agent-addressable cart capability.

**R3 — Interception resistance**
Interception of the continuation artifact alone does not permit successful redemption.

**R4 — Bounded resolution and replay**
One successful handoff resolves at most one logical cart, and replay is bounded so that repeated use cannot independently materialize or authorize multiple cart continuations.

**R5 — Preserve existing UCP identity**
If the browser cart already corresponds to a UCP cart, handoff resolves that same UCP cart rather than cloning it.

**R6 — Authority separation**
Cart continuation neither authenticates the buyer nor authorizes payment, checkout completion, or order placement.

**R7 — Independent authorization for private data**
Account-private or identity-dependent fields require independently satisfied authorization, such as applicable Identity Linking. Their presence in browser state alone is insufficient.

**R8 — Redemption-time state is authoritative**
The cart returned by a successful handoff represents the merchant's authoritative cart state at redemption/resolution time. State seen earlier in the browser may have changed.

**R9 — Semantic transport independence**
The cart-continuation meaning is transport-independent even if authentication and message mechanics differ across REST, MCP, A2A, or future transports.

**R10 — Verifiable Platform binding**
If continuation is restricted to an intended UCP Platform, that binding relies on verifiable Platform authentication. A self-asserted Platform profile URI alone is insufficient.

## 8. Candidate security decomposition

A future design may need several independent controls. They should not be collapsed into one concept:

| Layer                             | Purpose                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Browser/agent issuance binding    | Establish that agent-generated handoff material reached merchant issuance without arbitrary page-JS substitution |
| Verifier binding, e.g. PKCE-like  | Prevent interception of a continuation artifact alone from enabling redemption                                   |
| UCP Platform authentication       | Establish which Platform is making the external request                                                          |
| Identity Linking                  | Establish which user the Platform is authorized to act for                                                       |
| Payment/transaction authorization | Establish which consequential commercial action is permitted                                                     |

Existing UCP mechanisms should be reused where they satisfy a layer. This document does not introduce DPoP or another new cryptographic protocol.

## 9. Live-cart semantics

v0.3 retains **live state at resolution/redemption** as a requirement.

If the browser cart changes after handoff initiation but before successful resolution, the returned UCP cart is authoritative.

A compliant client integration therefore cannot treat the earlier browser snapshot as authoritative after handoff.

This is a data-consistency requirement, not an agent-reasoning conformance requirement.

## 10. Interoperability test matrix

| #  | Case                                                                  | Expected property                                                                                                                             |
| -- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Browser cart uses merchant-native ID only                             | Handoff can resolve one UCP cart without requiring a pre-existing `cart_id`                                                                   |
| 2  | Browser cart already maps to UCP cart                                 | Same `cart_id` is preserved                                                                                                                   |
| 3  | Browser cookie/session credential inspection                          | No browser credential appears outside its boundary                                                                                            |
| 4  | Continuation artifact stolen without any complementary verifier/proof | Attacker cannot successfully redeem                                                                                                           |
| 5  | Same successful handoff replayed                                      | Does not independently resolve/create another authorized continuation                                                                         |
| 6  | Two concurrent redemptions of a one-use candidate mechanism           | Atomic guard prevents multiple successful consumption                                                                                         |
| 7  | Browser cart mutates after handoff initiation                         | Returned UCP cart reflects authoritative resolution-time state                                                                                |
| 8  | Buyer/account-private field lacks independent authorization           | Field is omitted/redacted                                                                                                                     |
| 9  | Cart continuation presented as buyer authentication                   | Does not establish buyer identity                                                                                                             |
| 10 | Cart continuation presented as payment/order authority                | Does not authorize the action                                                                                                                 |
| 11 | REST and MCP implementations                                          | Same cart-continuation semantics; any Platform restriction is enforced by a signed UCP request whose verified `UCP-Agent` profile matches the profile recorded at issuance |
| 12 | A2A implementation                                                    | A2A client authentication is honored; any claimed Platform binding additionally demonstrates a verifiable mapping to the UCP Platform profile |
| 13 | Self-asserted Platform URI with no verifiable binding                 | Insufficient where the continuation claims Platform restriction                                                                               |
| 14 | Page JavaScript substitutes agent challenge material                  | A future browser-integrity mechanism must make the substitution detectable or impossible                                                      |

Test 14 is a requirements target, not a claim that current WebMCP supplies the needed primitive.

## 11. Reference Prototype

A TypeScript/Node reference prototype exists to test the feasibility and failure modes of one verifier-bound continuation design.

Current prototype status:

* **19 tests passing**
* **strict TypeScript clean**
* atomic concurrent redemption is tested;
* a mutation test demonstrates that removing the concurrency guard causes the concurrency test to fail;
* `TrustedIssuanceBridge` is intentionally simulated;
* `authenticatedPlatformProfile` comparison is **not** real Platform authentication;
* the prototype does **not** solve privileged browser issuance;
* commerce/private-field classification in the prototype is illustrative only.

The prototype demonstrates selected state-machine and concurrency properties. It does **not** demonstrate standards compliance, WebMCP security, production REST/MCP signature verification, A2A Platform-profile binding, or a production-ready continuation design.

## 12. Non-normative capability sketch

If maintainers ultimately conclude that a separate capability is warranted, one possible working identifier is:

`dev.ucp.shopping.cart_continuation`

This is only a discussion placeholder. v0.3 does not assert that a separate capability is necessary, or that this is the correct final name or placement.

## 13. Top maintainer questions

### A. Browser integrity binding

**What browser primitive can integrity-bind agent-generated challenge/secret material to merchant-side issuance without trusting arbitrary page JavaScript?**

Current WebMCP supplies a browser-agent model and browser-mediated tool invocation, but the required end-to-end issuance binding is not currently defined.

### B. A2A Platform binding

**For A2A redemption, how should the authenticated A2A client principal be verifiably related to the claimed UCP Platform profile?**

REST and MCP over streamable HTTP already have a UCP-native answer through signed
`UCP-Agent` requests and profile-published keys. The remaining question is
therefore A2A-specific and should reuse existing A2A/UCP authentication machinery
rather than creating a continuation-specific proof protocol.

### C. Commerce/private-data boundary

**Exactly which cart fields may cross this handoff without Identity Linking or another independent buyer authorization?**

This needs a concrete field-level answer before interoperability behavior can be standardized.

Secondary questions:

4. Can direct `cart_id` return or eager UCP-cart creation eliminate enough use cases to avoid a new capability?
5. What exact replay and lifetime bounds are necessary?
6. How should multiple handoffs of the same native cart converge on one UCP cart?
7. How is the merchant browser origin related to the merchant UCP service when those origins differ?
8. **Capability advertisement.** If a continuation capability is eventually defined, it should use existing UCP profile/capability negotiation. No new UCP discovery mechanism is currently justified. Browser→UCP bootstrap remains a separate WebMCP/browser question.

## 14. Future work

Checkout continuation is explicitly out of v1 scope.

If cart continuation proves necessary and interoperable, maintainers can later determine whether the same architecture generalizes safely to checkout. No such extension is assumed by this document.

---

## Bottom line

The standards gap is smaller than a new session-transfer protocol:

> An agent with an existing merchant browser cart lacks a standard, credential-safe way to resolve that cart into an agent-addressable UCP cart when it leaves the browser context.

Before defining a wire protocol, maintainers should decide three things:

1. whether a new continuation primitive is actually necessary versus direct/eager cart approaches;
2. what browser primitive can securely bind agent-originated handoff material to merchant issuance; and
3. how A2A Platform-profile binding and permissible cart-data disclosure are verified.
