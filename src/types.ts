/**
 * Browser-to-UCP Cart Continuation — reference prototype types.
 *
 * Explores one candidate mechanism against the requirements in
 * "Browser-to-UCP Cart Continuation — Problem Statement and Requirements v0.3".
 *
 * NOT a UCP implementation and NOT a production security system.
 *
 * Cart only. Checkout continuation is future work and is deliberately absent:
 * the single successful continuation result is a UCP cart.
 */

export interface CartItem {
  sku: string;
  quantity: number;
  unitPriceMinor: number;
  currency: string;
  title: string;
}

/**
 * Merchant-side browser session. The prototype never serializes any field of
 * this object into a continuation grant except `cartKey` (as `stateKey`).
 *
 * Revocation and session-termination semantics are intentionally not modeled:
 * v0.3 does not require them.
 */
export interface BrowserSession {
  sessionId: string;
  userId?: string;
  cartKey: string;
  /**
   * Present only to prove the negative in tests: a credential that lives in the
   * browser session and must never reach a grant, the UCP cart, or a redemption
   * response.
   */
  cookieValue: string;
}

/** Merchant-native cart. The authoritative commerce state. */
export interface NativeCart {
  cartKey: string;
  revision: number;
  items: CartItem[];
  /**
   * Account-private data attached to the native cart. Withheld from the
   * resolved UcpCart unless DemoDisclosurePolicy is given an independent
   * authorization signal (v0.3 R7).
   */
  accountPrivate: {
    userId?: string;
    savedPaymentMethodId?: string;
    loyaltyNumber?: string;
    internalRiskScore?: number;
  };
}

export interface ContinuationGrant {
  /** SHA-256 of the continuation code. The code itself is never persisted. */
  codeHash: string;
  /** S256 PKCE challenge bound at issuance. */
  codeChallenge: string;
  stateKey: string;
  platformProfile?: string;
  issuedAt: number;
  expiresAt: number;
  consumedAt?: number;
}

export interface UcpCart {
  id: string;
  sourceStateKey: string;
  items: CartItem[];
  revision: number;
  /**
   * Present only when DemoDisclosurePolicy released these fields on the
   * strength of an independent authorization. Absent by default (v0.3 R7).
   */
  accountPrivate?: NativeCart['accountPrivate'];
}

export interface IssueContinuationRequest {
  codeChallenge: string;
  platformProfile?: string;
  ttlMs?: number;
}

export interface IssueContinuationResponse {
  continuationCode: string;
  expiresIn: number;
  issuer: string;
}

export interface RedeemContinuationRequest {
  continuationCode: string;
  codeVerifier: string;
  /**
   * SIMULATION / TEST SEAM ONLY — NOT PLATFORM AUTHENTICATION.
   *
   * This is an already-trusted string compared for equality. String equality
   * against a self-asserted profile identifier does NOT satisfy v0.3 **R10**
   * ("Verifiable Platform binding"), which requires the binding to rest on
   * verifiable Platform authentication.
   *
   * Real UCP/A2A Platform-profile binding is unresolved (v0.3 §5 and maintainer
   * question B): A2A authenticates a client principal, and `UCP-Agent`
   * advertises a claimed profile URI, but the cryptographic mapping between
   * those two identities is not defined for this use case. Nothing here
   * supplies it.
   */
  authenticatedPlatformProfile?: string;
  /**
   * An authorization established independently of this continuation (v0.3 R7).
   * Omitted in the ordinary case, which withholds account-private fields.
   */
  simulatedIndependentAuthorization?: SimulatedIndependentAuthorization;
}

/**
 * The continuation's entire authority is to resolve the bound cart (v0.3 R3:
 * "resolve at most one merchant cart into the corresponding agent-addressable
 * UCP cart").
 *
 * Nothing else is returned. In particular the continuation does not itself
 * grant authority to perform subsequent UCP operations on that cart; whatever
 * authorization those require is established separately.
 */
export interface RedeemContinuationResponse {
  cart: UcpCart;
}

/**
 * SimulatedIndependentAuthorization
 *
 * SIMULATION ONLY — NOT IDENTITY LINKING AND NOT AUTHENTICATION.
 *
 * A caller-provided plain object. Nothing verifies it: any caller can assert
 * any `subjectUserId`. It does not prove that an independent authorization was
 * ever obtained, let alone authenticated.
 *
 * What it demonstrates is separation of authority (v0.3 R7): account-private
 * fields are released on the strength of a signal established *outside* the
 * continuation, and the continuation itself never produces one. Real
 * deployments would substitute Identity Linking or another sufficient UCP
 * authorization, and would have to authenticate it.
 */
export interface SimulatedIndependentAuthorization {
  /** Unverified. Asserted by the caller, trusted by nothing. */
  unverifiedSubjectUserId: string;
}

/**
 * DemoDisclosurePolicy
 *
 * ILLUSTRATIVE ONLY. This is the prototype's own guess at which cart fields may
 * cross the handoff, NOT a claimed UCP rule.
 *
 * v0.3 leaves the commerce/private-data boundary explicitly unresolved
 * (maintainer question C): "Exactly which cart fields may cross this handoff
 * without Identity Linking or another independent buyer authorization? This
 * needs a concrete field-level answer before interoperability behavior can be
 * standardized."
 *
 * The policy below encodes one conservative answer — line items cross,
 * account-private fields do not unless an independent authorization is
 * supplied — purely so the withholding behavior is executable and testable.
 */
export interface DemoDisclosurePolicy {
  /**
   * Returns the account-private fields that may be disclosed, given whatever
   * independent authorization was supplied. Returns undefined to withhold.
   */
  discloseAccountPrivate(
    cart: NativeCart,
    authorization: SimulatedIndependentAuthorization | undefined,
  ): NativeCart['accountPrivate'] | undefined;
}

/**
 * Security-sensitive validation failures collapse to `invalid_continuation`
 * rather than reveal which predicate failed.
 *
 * Cart-only: there is no `projection_not_supported`, because there is no
 * resource-type selection to fail.
 */
export type ContinuationErrorCode =
  | 'invalid_request'
  | 'invalid_continuation'
  | 'state_unavailable'
  | 'temporarily_unavailable';

/**
 * Internal, non-disclosed reason for a failure. Retained only so tests can
 * assert *why* a redemption failed. A conforming transport binding MUST NOT
 * serialize this to the Platform.
 */
export type ContinuationFailureReason =
  | 'unknown_code'
  | 'expired'
  | 'already_consumed'
  | 'invalid_verifier'
  | 'platform_mismatch'
  | 'unknown_cart';

export class ContinuationError extends Error {
  constructor(
    readonly code: ContinuationErrorCode,
    /** Not for the wire. See ContinuationFailureReason. */
    readonly internalReason: ContinuationFailureReason,
  ) {
    super(code);
    this.name = 'ContinuationError';
  }
}

/**
 * TrustedIssuanceBridge
 *
 * This interface represents the unresolved browser/agent integrity boundary
 * identified by v0.3 §4 and maintainer question A. It is intentionally
 * simulated, and is not implemented using ordinary page JavaScript.
 *
 * v0.3 §4 is precise about what is and is not missing: WebMCP *does* distinguish
 * a browser agent from page JavaScript, and mediates tool invocation. What it
 * does not define is an integrity-preserving primitive that binds
 * agent-generated challenge material through the browser to merchant-side
 * issuance while excluding arbitrary page JavaScript from substituting it.
 *
 * The prototype's implementation only demonstrates the desired interface
 * semantics. It is not an enforceable browser security property.
 *
 * The bridge represents an **already-bound active browser context**. It takes
 * no session identifier, so neither a browser cookie nor a merchant session id
 * crosses into the agent-facing API (v0.3 R1).
 */
export interface TrustedIssuanceBridge {
  /**
   * Called from the privileged context. Takes challenge/platform material only
   * and returns the continuation code to the agent, without exposing it to page
   * script and without the agent ever holding browser cookies, session
   * credentials, or a merchant session identifier.
   */
  requestContinuation(request: IssueContinuationRequest): Promise<IssueContinuationResponse>;
}
