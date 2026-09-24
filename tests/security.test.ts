import { describe, expect, it } from 'vitest';
import { UntrustedIssuanceError } from '../src/agent.js';
import { ContinuationError } from '../src/types.js';
import { generateCodeVerifier, s256 } from '../src/crypto.js';
import { BROWSER_COOKIE, PLATFORM_A, PLATFORM_B, agentFor, harness } from './helpers.js';

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ContinuationError) return error.internalReason;
    throw error;
  }
  throw new Error('expected a ContinuationError');
}

function wireCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ContinuationError) return error.code;
    throw error;
  }
  throw new Error('expected a ContinuationError');
}

describe('continuation security', () => {
  it('R2: a continuation artifact alone is not a reusable cart capability', async () => {
    const h = harness();
    const agent = agentFor(h);
    const issued = await agent.requestContinuation();

    // Everything a holder of the artifact alone possesses. No verifier.
    const artifactOnly = () =>
      h.merchant.redeemContinuation({
        continuationCode: issued.continuationCode,
        codeVerifier: generateCodeVerifier(),
      });

    // The public error, not the internal reason: the artifact holder learns
    // only that the continuation is invalid.
    expect(wireCodeOf(artifactOnly)).toBe('invalid_continuation');

    // The artifact conferred nothing addressable — no cart exists to address.
    expect(h.merchant.carts.allUcpCarts()).toHaveLength(0);

    // Repeating it does not accumulate authority.
    expect(wireCodeOf(artifactOnly)).toBe('invalid_continuation');
    expect(h.merchant.carts.allUcpCarts()).toHaveLength(0);

    // Failed attempts do not consume the grant, so the legitimate holder —
    // the party that retained the verifier — is unaffected.
    const { cart } = agent.redeem(h.merchant, issued.continuationCode);
    expect(cart.id).toMatch(/^ucp_cart_/);
    expect(h.merchant.carts.allUcpCarts()).toHaveLength(1);
  });

  it('R3 / case 4: stolen continuation without the verifier is rejected', async () => {
    const h = harness();
    const agent = agentFor(h);
    const issued = await agent.requestContinuation();

    // Attacker holds the code but never saw the verifier.
    const attempt = () =>
      h.merchant.redeemContinuation({
        continuationCode: issued.continuationCode,
        codeVerifier: generateCodeVerifier(),
      });

    expect(reasonOf(attempt)).toBe('invalid_verifier');
    expect(h.merchant.carts.allUcpCarts()).toHaveLength(0);
  });

  it('R3: wrong verifier is rejected and does not consume the grant', async () => {
    const h = harness();
    const agent = agentFor(h);
    const issued = await agent.requestContinuation();

    const attempt = () =>
      h.merchant.redeemContinuation({
        continuationCode: issued.continuationCode,
        codeVerifier: 'not-the-verifier',
      });

    expect(reasonOf(attempt)).toBe('invalid_verifier');

    // Anti-DoS: the legitimate holder can still redeem.
    const { cart } = agent.redeem(h.merchant, issued.continuationCode);
    expect(cart.id).toMatch(/^ucp_cart_/);
  });

  it('R4 / case 5: replay after a successful redemption is rejected', async () => {
    const h = harness();
    const agent = agentFor(h);
    const issued = await agent.requestContinuation();

    agent.redeem(h.merchant, issued.continuationCode);

    expect(reasonOf(() => agent.redeem(h.merchant, issued.continuationCode))).toBe(
      'already_consumed',
    );
    expect(h.merchant.carts.allUcpCarts()).toHaveLength(1);
  });

  it('R4: expired code is rejected', async () => {
    const h = harness();
    const agent = agentFor(h);
    const issued = await agent.requestContinuation();

    h.clock.now += 5 * 60 * 1000;

    expect(reasonOf(() => agent.redeem(h.merchant, issued.continuationCode))).toBe('expired');
    expect(h.merchant.carts.allUcpCarts()).toHaveLength(0);
  });

  it('case 13: simulated platform mismatch is rejected (NOT R10 evidence)', async () => {
    const h = harness();
    const agent = agentFor(h, PLATFORM_A);
    const issued = await agent.requestContinuation();

    const attempt = () =>
      h.merchant.redeemContinuation({
        continuationCode: issued.continuationCode,
        codeVerifier: agent.verifierForTest()!,
        authenticatedPlatformProfile: PLATFORM_B,
      });

    expect(reasonOf(attempt)).toBe('platform_mismatch');

    // A missing platform assertion is equally rejected when the grant is bound.
    const unauthenticated = () =>
      h.merchant.redeemContinuation({
        continuationCode: issued.continuationCode,
        codeVerifier: agent.verifierForTest()!,
      });
    expect(reasonOf(unauthenticated)).toBe('platform_mismatch');

    // The intended platform still succeeds.
    expect(agent.redeem(h.merchant, issued.continuationCode).cart.id).toMatch(/^ucp_cart_/);
  });

  it('R1 / case 3: no browser credential appears in grant, storage or result', async () => {
    const h = harness();
    const agent = agentFor(h, PLATFORM_A);
    const issued = await agent.requestContinuation();
    const result = agent.redeem(h.merchant, issued.continuationCode);

    const surfaces = [
      JSON.stringify(issued),
      JSON.stringify(h.merchant.continuations.all()),
      JSON.stringify(result),
      JSON.stringify(h.merchant.carts.allUcpCarts()),
    ];

    for (const surface of surfaces) {
      expect(surface).not.toContain(BROWSER_COOKIE);
      expect(surface).not.toContain('sid=');
      expect(surface).not.toContain(h.session.sessionId);
    }

    // The raw code is never persisted — only its hash.
    const stored = JSON.stringify(h.merchant.continuations.all());
    expect(stored).not.toContain(issued.continuationCode);
  });

  it('R1: the merchant session identifier stays merchant/bridge-internal', async () => {
    const h = harness();
    const agent = agentFor(h);

    // The agent's public issuance API takes no session identifier at all: the
    // bridge already represents the bound browser context.
    expect(agent.requestContinuation).toHaveLength(0);

    const issued = await agent.requestContinuation();
    const { cart } = agent.redeem(h.merchant, issued.continuationCode);

    const sessionId = h.session.sessionId;
    expect(sessionId).toBeTruthy();

    // It appears in none of the artifacts that cross the boundary.
    expect(JSON.stringify(issued)).not.toContain(sessionId);
    expect(JSON.stringify(h.merchant.continuations.all())).not.toContain(sessionId);
    expect(JSON.stringify(cart)).not.toContain(sessionId);

    // The agent's own state holds no session identifier. Its bridge reference
    // does — unavoidably, since this prototype is single-process and the bridge
    // is a plain object. In a real deployment the bridge sits behind a
    // process/context boundary, so what matters is the API surface asserted
    // above, not object-graph reachability.
    const agentOwnState = Object.fromEntries(
      Object.entries(agent as unknown as Record<string, unknown>).filter(
        ([, value]) => value !== h.bridge,
      ),
    );
    expect(JSON.stringify(agentOwnState)).not.toContain(sessionId);

    // The grant binds the cart key, never the session.
    const grant = h.merchant.continuations.all()[0]!;
    expect(grant.stateKey).toBe(h.session.cartKey);
    expect(Object.values(grant)).not.toContain(sessionId);
  });

  it('R6 / cases 9-10: no buyer identity, payment, checkout or order authority', async () => {
    const h = harness();
    const agent = agentFor(h);
    const issued = await agent.requestContinuation();
    const result = agent.redeem(h.merchant, issued.continuationCode);

    // Redemption returns the resolved cart and nothing else. No capability
    // grant, no token, no identity claim — the continuation's whole authority
    // was to resolve this cart.
    expect(Object.keys(result)).toEqual(['cart']);

    // Nothing identity-, payment- or order-shaped comes back.
    const returned = JSON.stringify(result);
    for (const forbidden of ['capabilit', 'token', 'identity', 'payment', 'order', 'checkout']) {
      expect(returned.toLowerCase()).not.toContain(forbidden);
    }

    // No such operation is reachable on the merchant surface at all.
    const surface = h.merchant as unknown as Record<string, unknown>;
    for (const method of ['completeCheckout', 'placeOrder', 'authorizePayment', 'pay']) {
      expect(surface[method]).toBeUndefined();
    }
  });

  it('R7 / case 8: account-private fields are omitted without independent authorization', async () => {
    const h = harness();
    const agent = agentFor(h);
    const issued = await agent.requestContinuation();
    const { cart } = agent.redeem(h.merchant, issued.continuationCode);

    const native = h.merchant.carts.getNativeCart(h.session.cartKey)!;
    expect(native.accountPrivate.savedPaymentMethodId).toBe('pm_secret_123');

    // Distinctive values only. `internalRiskScore` (17) is checked structurally
    // below rather than by substring: short numbers collide with generated ids.
    const disclosed = JSON.stringify(cart);
    for (const secret of ['pm_secret_123', 'LOY-999', 'user_42']) {
      expect(disclosed).not.toContain(secret);
    }
    expect(cart).not.toHaveProperty('accountPrivate');
    expect(Object.keys(cart).sort()).toEqual(['id', 'items', 'revision', 'sourceStateKey']);
  });

  it('R7: the continuation alone never supplies the authorization that releases them', async () => {
    const h = harness();
    const agent = agentFor(h);
    const issued = await agent.requestContinuation();

    // Supplied separately from the continuation. SIMULATED — unverified, and
    // not Identity Linking. The field split is illustrative
    // (DemoDisclosurePolicy); what this asserts is only that the continuation
    // does not by itself authorize disclosure.
    const { cart } = agent.redeem(h.merchant, issued.continuationCode, {
      unverifiedSubjectUserId: 'user_42',
    });

    expect(cart.accountPrivate?.savedPaymentMethodId).toBe('pm_secret_123');

    // A continuation for the same cart, with no independent authorization,
    // still withholds.
    const other = agentFor(h);
    const otherIssued = await other.requestContinuation();
    const withheld = other.redeem(h.merchant, otherIssued.continuationCode).cart;
    expect(withheld).not.toHaveProperty('accountPrivate');
  });

  it('case 14: page-script challenge is rejected (interface semantics only)', async () => {
    const h = harness();

    // Driven through the bridge's simulation-only entry point. The normal Agent
    // API offers no caller-controlled origin, which is the point: a real
    // implementation must *detect* substitution, and this cannot.
    await expect(
      h.bridge.simulatePageScriptIssuance({
        codeChallenge: s256(generateCodeVerifier()),
      }),
    ).rejects.toBeInstanceOf(UntrustedIssuanceError);

    expect(h.merchant.continuations.all()).toHaveLength(0);
  });

  it('distinct failure predicates collapse to one wire error', async () => {
    const h = harness();
    const agent = agentFor(h, PLATFORM_A);
    const issued = await agent.requestContinuation();

    const wrongVerifier = wireCodeOf(() =>
      h.merchant.redeemContinuation({
        continuationCode: issued.continuationCode,
        codeVerifier: 'wrong',
      }),
    );
    const unknownCode = wireCodeOf(() =>
      h.merchant.redeemContinuation({ continuationCode: 'nope', codeVerifier: 'wrong' }),
    );
    const wrongPlatform = wireCodeOf(() =>
      h.merchant.redeemContinuation({
        continuationCode: issued.continuationCode,
        codeVerifier: agent.verifierForTest()!,
        authenticatedPlatformProfile: PLATFORM_B,
      }),
    );

    expect(wrongVerifier).toBe('invalid_continuation');
    expect(unknownCode).toBe('invalid_continuation');
    expect(wrongPlatform).toBe('invalid_continuation');
  });
});
