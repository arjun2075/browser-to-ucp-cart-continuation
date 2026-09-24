import { describe, expect, it } from 'vitest';
import { ContinuationError, type RedeemContinuationResponse } from '../src/types.js';
import { agentFor, harness } from './helpers.js';

describe('concurrent redemption', () => {
  it('R4 / case 6: concurrent redemption commits at most once', async () => {
    const h = harness();
    const agent = agentFor(h);
    const issued = await agent.requestContinuation();
    const verifier = agent.verifierForTest()!;

    const redeem = (): RedeemContinuationResponse =>
      h.merchant.redeemContinuation({
        continuationCode: issued.continuationCode,
        codeVerifier: verifier,
      });

    const succeeded: RedeemContinuationResponse[] = [];
    const failed: unknown[] = [];
    const run = () => {
      try {
        succeeded.push(redeem());
      } catch (error) {
        failed.push(error);
      }
    };

    // onBeforeCommit runs at the start of consume(), before the first caller
    // reaches its own read of `consumedAt`. That lets 15 further callers run
    // fully through consume() first. Only the guard decides how many commit —
    // if it is removed, all 16 succeed.
    let interleaved = false;
    h.merchant.continuations.onBeforeCommit = () => {
      if (interleaved) return;
      interleaved = true;
      for (let i = 0; i < 15; i += 1) run();
    };

    run();

    expect(interleaved).toBe(true);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(15);

    for (const error of failed) {
      expect(error).toBeInstanceOf(ContinuationError);
      expect((error as ContinuationError).internalReason).toBe('already_consumed');
    }

    expect(h.merchant.carts.allUcpCarts()).toHaveLength(1);
    expect(h.merchant.continuations.all()[0]!.consumedAt).toBeDefined();
  });

  // Not a concurrency test: redeemContinuation is synchronous, so these run
  // strictly one after the other. What it demonstrates is convergence — two
  // distinct continuations for one native cart resolve to the same UCP cart.
  it('two distinct continuations for one cart converge on one UCP cart', async () => {
    const h = harness();
    const a = agentFor(h);
    const b = agentFor(h);
    const issuedA = await a.requestContinuation();
    const issuedB = await b.requestContinuation();

    const resultA = a.redeem(h.merchant, issuedA.continuationCode);
    const resultB = b.redeem(h.merchant, issuedB.continuationCode);

    expect(resultA.cart.id).toBe(resultB.cart.id);
    expect(h.merchant.carts.allUcpCarts()).toHaveLength(1);
  });
});
