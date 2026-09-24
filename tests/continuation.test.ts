import { describe, expect, it } from 'vitest';
import { agentFor, harness, items } from './helpers.js';

describe('cart continuation resolution', () => {
  it('R5 / case 1: native cart with no UCP id resolves to one UCP cart', async () => {
    const h = harness();
    const agent = agentFor(h);

    const issued = await agent.requestContinuation();
    const { cart } = agent.redeem(h.merchant, issued.continuationCode);

    expect(cart.id).toMatch(/^ucp_cart_/);
    expect(cart.sourceStateKey).toBe(h.session.cartKey);
    expect(cart.items).toEqual(items());
    expect(h.merchant.carts.allUcpCarts()).toHaveLength(1);
  });

  it('R5 / case 2: existing UCP cart is preserved, not cloned', async () => {
    const h = harness();

    const first = agentFor(h);
    const firstIssued = await first.requestContinuation();
    const firstCart = first.redeem(h.merchant, firstIssued.continuationCode).cart;

    const second = agentFor(h);
    const secondIssued = await second.requestContinuation();
    const secondCart = second.redeem(h.merchant, secondIssued.continuationCode).cart;

    expect(secondCart.id).toBe(firstCart.id);
    expect(h.merchant.carts.allUcpCarts()).toHaveLength(1);
  });

  it('R8 / case 7: cart mutated after issuance resolves to live state', async () => {
    const h = harness();
    const agent = agentFor(h);

    const issued = await agent.requestContinuation();

    const mutated = [
      { sku: 'SKU-9', quantity: 5, unitPriceMinor: 700, currency: 'USD', title: 'Filter papers' },
    ];
    h.merchant.carts.setItems(h.session.cartKey, mutated);

    const { cart } = agent.redeem(h.merchant, issued.continuationCode);

    expect(cart.items).toEqual(mutated);
    expect(cart.items).not.toEqual(items());
    expect(cart.revision).toBe(2);
  });

  it('R5 / Q6: two grants for one cart converge on one UCP cart', async () => {
    const h = harness();

    const a = agentFor(h);
    const b = agentFor(h);
    const issuedA = await a.requestContinuation();
    const issuedB = await b.requestContinuation();

    expect(issuedA.continuationCode).not.toBe(issuedB.continuationCode);

    const cartA = a.redeem(h.merchant, issuedA.continuationCode).cart;
    const cartB = b.redeem(h.merchant, issuedB.continuationCode).cart;

    expect(cartB.id).toBe(cartA.id);
    expect(h.merchant.carts.allUcpCarts()).toHaveLength(1);
  });

  it('issuance response carries code, expiry and issuer', async () => {
    const h = harness();
    const agent = agentFor(h);

    const issued = await agent.requestContinuation();

    expect(issued.continuationCode).toBeTruthy();
    expect(issued.expiresIn).toBe(300);
    expect(issued.issuer).toBe(h.merchant.issuer);
  });

  it('state deleted before redemption fails as state_unavailable, no stale recreation', async () => {
    const h = harness();
    const agent = agentFor(h);

    const issued = await agent.requestContinuation();
    h.merchant.carts.deleteNativeCart(h.session.cartKey);

    expect(() => agent.redeem(h.merchant, issued.continuationCode)).toThrowError(
      /state_unavailable/,
    );
    expect(h.merchant.carts.allUcpCarts()).toHaveLength(0);
  });
});
