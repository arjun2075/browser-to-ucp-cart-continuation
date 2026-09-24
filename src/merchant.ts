import { CartStore } from './cart-store.js';
import { ContinuationStore } from './continuation-store.js';
import { constantTimeEqual, generateContinuationCode, hashCode, s256 } from './crypto.js';
import {
  ContinuationError,
  type BrowserSession,
  type ContinuationFailureReason,
  type IssueContinuationRequest,
  type IssueContinuationResponse,
  type RedeemContinuationRequest,
  type RedeemContinuationResponse,
} from './types.js';

export const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Security-sensitive failures collapse to one wire error. */
function invalidContinuation(reason: ContinuationFailureReason): ContinuationError {
  return new ContinuationError('invalid_continuation', reason);
}

export interface MerchantOptions {
  issuer?: string;
  defaultTtlMs?: number;
  now?: () => number;
}

export class Merchant {
  readonly issuer: string;
  readonly carts: CartStore;
  readonly continuations: ContinuationStore;
  readonly #defaultTtlMs: number;
  readonly #now: () => number;
  readonly #sessions = new Map<string, BrowserSession>();

  constructor(options: MerchantOptions = {}) {
    this.issuer = options.issuer ?? 'https://merchant.example';
    this.#defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.#now = options.now ?? Date.now;
    this.carts = new CartStore();
    this.continuations = new ContinuationStore();
  }

  putSession(session: BrowserSession): void {
    this.#sessions.set(session.sessionId, session);
  }

  getSession(sessionId: string): BrowserSession | undefined {
    return this.#sessions.get(sessionId);
  }

  /**
   * Issuance.
   *
   * The grant binds the cart key, the S256 challenge, expiry, and the optional
   * simulated Platform profile. It never contains browser credentials
   * (v0.3 R1), and the code itself is persisted only as a hash.
   */
  issueContinuation(
    browserSession: BrowserSession,
    request: IssueContinuationRequest,
  ): IssueContinuationResponse {
    if (!request.codeChallenge) {
      throw new ContinuationError('invalid_request', 'unknown_code');
    }

    const now = this.#now();
    const ttlMs = request.ttlMs ?? this.#defaultTtlMs;
    const continuationCode = generateContinuationCode();

    this.continuations.put({
      codeHash: hashCode(continuationCode),
      codeChallenge: request.codeChallenge,
      stateKey: browserSession.cartKey,
      ...(request.platformProfile !== undefined
        ? { platformProfile: request.platformProfile }
        : {}),
      issuedAt: now,
      expiresAt: now + ttlMs,
    });

    return {
      continuationCode,
      expiresIn: Math.floor(ttlMs / 1000),
      issuer: this.issuer,
    };
  }

  /**
   * Redemption: resolve the bound merchant cart into an agent-addressable UCP
   * cart.
   *
   * Validation order matters: every predicate that could leak information runs
   * before the code is consumed, and a failed verifier never consumes the grant
   * (anti-DoS).
   */
  redeemContinuation(request: RedeemContinuationRequest): RedeemContinuationResponse {
    if (!request.continuationCode || !request.codeVerifier) {
      throw new ContinuationError('invalid_request', 'unknown_code');
    }

    const codeHash = hashCode(request.continuationCode);
    const grant = this.continuations.get(codeHash);
    if (!grant) throw invalidContinuation('unknown_code');

    const now = this.#now();
    if (now >= grant.expiresAt) throw invalidContinuation('expired');
    if (grant.consumedAt !== undefined) throw invalidContinuation('already_consumed');

    if (!constantTimeEqual(s256(request.codeVerifier), grant.codeChallenge)) {
      throw invalidContinuation('invalid_verifier');
    }

    // SIMULATED PLATFORM BINDING — NOT AUTHENTICATION. String equality against
    // a self-asserted profile identifier does not satisfy v0.3 R10; see
    // SimulatedPlatformBinding in agent.ts.
    if (grant.platformProfile !== undefined) {
      const asserted = request.authenticatedPlatformProfile;
      if (asserted === undefined || !constantTimeEqual(asserted, grant.platformProfile)) {
        throw invalidContinuation('platform_mismatch');
      }
    }

    // Live cart at redemption time, not state captured at issuance (v0.3 R8).
    const native = this.carts.getNativeCart(grant.stateKey);
    if (!native) throw new ContinuationError('state_unavailable', 'unknown_cart');

    // Single-winner consumption: exactly one caller wins the race for this
    // grant, and every later attempt is rejected as replay.
    //
    // NOT TRANSACTIONALLY ATOMIC. Grant consumption and cart resolution are two
    // separate steps in this in-memory prototype. If resolution failed after
    // consumption succeeded, the grant would already be spent. A production
    // implementation requiring retry after merchant-side resolution failure
    // would need an appropriate transactional persistence boundary.
    if (!this.continuations.consume(codeHash, now)) {
      throw invalidContinuation('already_consumed');
    }
    const cart = this.carts.resolveCart(native, request.simulatedIndependentAuthorization);

    return { cart };
  }
}
