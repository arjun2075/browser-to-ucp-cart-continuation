import type { ContinuationGrant } from './types.js';

/**
 * In-memory grant store.
 *
 * Node runs this single-threaded, so `consume` decides a single winner by
 * construction: it performs its check and its write with no intervening
 * `await`. A real implementation needs the equivalent database guarantee —
 * e.g. `UPDATE grants SET consumed_at = ? WHERE code_hash = ? AND consumed_at
 * IS NULL` and a check of the affected row count.
 *
 * This covers consumption only. It says nothing about the wider redemption
 * step: grant consumption and cart resolution are not transactionally atomic
 * in this prototype. See `Merchant.redeemContinuation`.
 */
export class ContinuationStore {
  readonly #grants = new Map<string, ContinuationGrant>();

  /**
   * Test seam. Runs at the *start* of `consume`, before its read of
   * `consumedAt` — it does not interleave between that read and the write,
   * which are adjacent statements.
   *
   * Its purpose is to let a test drive additional callers fully through
   * `consume` before the original caller reaches its own read, so that the
   * single-winner assertion exercises the guard rather than Node's scheduler.
   */
  onBeforeCommit: (() => void) | undefined;

  put(grant: ContinuationGrant): void {
    this.#grants.set(grant.codeHash, grant);
  }

  get(codeHash: string): ContinuationGrant | undefined {
    return this.#grants.get(codeHash);
  }

  /**
   * Marks the grant consumed if and only if it is currently unconsumed.
   * Returns true for the single winning caller, false for every other.
   */
  consume(codeHash: string, at: number): boolean {
    this.onBeforeCommit?.();
    // Read and write are adjacent and must stay that way: a decision taken
    // before a suspension point can be stale by the time it is applied.
    const grant = this.#grants.get(codeHash);
    if (!grant || grant.consumedAt !== undefined) return false;
    grant.consumedAt = at;
    return true;
  }

  /** Test/demo visibility into everything persisted. */
  all(): ContinuationGrant[] {
    return [...this.#grants.values()];
  }
}
