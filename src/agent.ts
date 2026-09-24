import type { Merchant } from './merchant.js';
import { generateCodeVerifier, s256 } from './crypto.js';
import type {
  SimulatedIndependentAuthorization,
  IssueContinuationRequest,
  IssueContinuationResponse,
  RedeemContinuationResponse,
  TrustedIssuanceBridge,
} from './types.js';

export class UntrustedIssuanceError extends Error {
  constructor() {
    super('challenge did not originate from a privileged context');
    this.name = 'UntrustedIssuanceError';
  }
}

/**
 * SIMULATED TrustedIssuanceBridge.
 *
 * This interface represents the unresolved browser/agent integrity boundary
 * identified by v0.3 §4 and maintainer question A. It is intentionally
 * simulated, and is not implemented using ordinary page JavaScript.
 *
 * The simulation below is a stand-in, not a security control. The ordinary
 * TrustedIssuanceBridge path assumes that challenge material arrived through a
 * privileged browser/agent context; this prototype cannot prove that assumption.
 *
 * simulatePageScriptIssuance() exists only to make the desired rejection
 * semantics executable in tests. It does not demonstrate that current WebMCP
 * can detect page-JavaScript substitution.
 */
export class SimulatedTrustedIssuanceBridge implements TrustedIssuanceBridge {
  /**
   * The bridge is bound to one already-active browser context at construction.
   * `sessionId` stays internal to the bridge and the merchant: it is never a
   * parameter of any method an agent or page can call (v0.3 R1).
   */
  constructor(
    private readonly merchant: Merchant,
    private readonly sessionId: string,
  ) {}

  /**
   * The ordinary path. Reaching this method at all stands in for the challenge
   * having arrived through the privileged context.
   *
   * The caller supplies challenge/platform material only — no session
   * identifier, because the bridge already represents the active session.
   */
  async requestContinuation(
    request: IssueContinuationRequest,
  ): Promise<IssueContinuationResponse> {
    const session = this.merchant.getSession(this.sessionId);
    if (!session) throw new Error('bridge is not bound to an active browser session');

    // The bridge resolves the session server-side. The agent never sees it, and
    // no part of it is passed back out.
    return this.merchant.issueContinuation(session, request);
  }

  /**
   * SIMULATION ONLY. Models ordinary page JavaScript attempting to substitute
   * agent challenge material, so v0.3 test-matrix case 14 is executable — which
   * v0.3 itself flags as "a requirements target, not a claim that current
   * WebMCP supplies the needed primitive".
   *
   * It lives on the simulated bridge rather than on TrustedIssuanceBridge or
   * Agent because no production API should offer a caller-controlled origin.
   */
  async simulatePageScriptIssuance(request: IssueContinuationRequest): Promise<never> {
    void request;
    throw new UntrustedIssuanceError();
  }
}

/**
 * SimulatedPlatformBinding
 *
 * NOT PLATFORM AUTHENTICATION. A test seam that carries a profile identifier
 * which the merchant compares for equality.
 *
 * String equality against a self-asserted identifier does not satisfy v0.3
 * **R10** ("Verifiable Platform binding": a self-asserted Platform profile URI
 * alone is insufficient). Real UCP/A2A Platform-profile binding is unresolved —
 * v0.3 §5 notes that A2A authenticates a client principal and `UCP-Agent`
 * advertises a claimed profile URI, but the cryptographic mapping between them
 * is undefined for this use case.
 *
 * The name is deliberate: nothing here should be mistaken for production
 * authentication.
 */
export class SimulatedPlatformBinding {
  constructor(readonly profile: string) {}

  /** The value a real deployment would instead derive from authenticated transport. */
  assertedProfile(): string {
    return this.profile;
  }
}

/**
 * The agent privileged context. Generates and retains the verifier; only the
 * S256 challenge ever leaves.
 */
export class Agent {
  #verifier: string | undefined;

  constructor(
    private readonly bridge: TrustedIssuanceBridge,
    private readonly platformBinding?: SimulatedPlatformBinding,
  ) {}

  get platformProfile(): string | undefined {
    return this.platformBinding?.profile;
  }

  /**
   * Supplies challenge and platform material only. The agent holds no browser
   * session identifier and never passes one: the bridge already represents the
   * active browser context (v0.3 R1).
   */
  async requestContinuation(options: { ttlMs?: number } = {}): Promise<IssueContinuationResponse> {
    this.#verifier = generateCodeVerifier();

    const request: IssueContinuationRequest = {
      codeChallenge: s256(this.#verifier),
      ...(this.platformProfile !== undefined ? { platformProfile: this.platformProfile } : {}),
      ...(options.ttlMs !== undefined ? { ttlMs: options.ttlMs } : {}),
    };

    return this.bridge.requestContinuation(request);
  }

  /** Redemption over a UCP transport. The verifier never left this context. */
  redeem(
    merchant: Merchant,
    continuationCode: string,
    simulatedIndependentAuthorization?: SimulatedIndependentAuthorization,
  ): RedeemContinuationResponse {
    if (this.#verifier === undefined) throw new Error('no verifier: request a continuation first');
    return merchant.redeemContinuation({
      continuationCode,
      codeVerifier: this.#verifier,
      ...(this.platformBinding !== undefined
        ? { authenticatedPlatformProfile: this.platformBinding.assertedProfile() }
        : {}),
      ...(simulatedIndependentAuthorization !== undefined
        ? { simulatedIndependentAuthorization }
        : {}),
    });
  }

  /** Test-only: exposes the verifier so tests can construct attacker cases. */
  verifierForTest(): string | undefined {
    return this.#verifier;
  }
}
