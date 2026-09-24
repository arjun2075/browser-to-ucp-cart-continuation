import { randomUUID } from 'node:crypto';
import type {
  CartItem,
  DemoDisclosurePolicy,
  SimulatedIndependentAuthorization,
  NativeCart,
  UcpCart,
} from './types.js';

/**
 * ILLUSTRATIVE ONLY — see DemoDisclosurePolicy in types.ts. v0.3 leaves the
 * field-level commerce/private boundary unresolved (maintainer question C).
 *
 * This default withholds every account-private field unless an independent
 * authorization naming the cart's own owner is supplied.
 */
export const defaultDisclosurePolicy: DemoDisclosurePolicy = {
  discloseAccountPrivate(cart, authorization) {
    if (authorization === undefined) return undefined;
    if (authorization.unverifiedSubjectUserId !== cart.accountPrivate.userId) return undefined;
    return cart.accountPrivate;
  },
};

/**
 * Native carts plus the native→UCP cart mapping.
 *
 * The mapping is what makes "multiple continuations for one logical cart
 * converge on one UCP cart" hold (v0.3 R5): resolution is keyed by `cartKey`,
 * not by the continuation that triggered it.
 *
 * The map is named for what it persists — a durable association between a
 * native cart and its UCP counterpart — rather than renamed to match the
 * request-time verb.
 */
export class CartStore {
  readonly #native = new Map<string, NativeCart>();
  readonly #ucp = new Map<string, UcpCart>();
  /** cartKey -> ucpCartId */
  readonly #association = new Map<string, string>();

  constructor(private readonly policy: DemoDisclosurePolicy = defaultDisclosurePolicy) {}

  createNativeCart(
    cartKey: string,
    items: CartItem[],
    accountPrivate: NativeCart['accountPrivate'] = {},
  ): NativeCart {
    const cart: NativeCart = { cartKey, revision: 1, items, accountPrivate };
    this.#native.set(cartKey, cart);
    return cart;
  }

  getNativeCart(cartKey: string): NativeCart | undefined {
    return this.#native.get(cartKey);
  }

  /** Mutates the live native cart; bumps revision. Used to exercise live-cart semantics. */
  setItems(cartKey: string, items: CartItem[]): void {
    const cart = this.#native.get(cartKey);
    if (!cart) throw new Error(`no native cart ${cartKey}`);
    cart.items = items;
    cart.revision += 1;
  }

  deleteNativeCart(cartKey: string): void {
    this.#native.delete(cartKey);
  }

  getUcpCart(id: string): UcpCart | undefined {
    return this.#ucp.get(id);
  }

  /**
   * Resolve the UCP cart for this native cart, creating exactly one if none is
   * associated yet (v0.3 R5: an existing UCP cart is preserved, not cloned).
   *
   * The returned cart carries the native cart's *current* items: resolution
   * reads live state at redemption time (v0.3 R8), not a snapshot captured at
   * issuance.
   *
   * Account-private fields cross only if DemoDisclosurePolicy releases them on
   * the strength of an independent authorization (v0.3 R7).
   */
  resolveCart(native: NativeCart, authorization?: SimulatedIndependentAuthorization): UcpCart {
    const disclosed = this.policy.discloseAccountPrivate(native, authorization);

    const existingId = this.#association.get(native.cartKey);
    const existing = existingId === undefined ? undefined : this.#ucp.get(existingId);

    const resolved: UcpCart = existing ?? {
      id: `ucp_cart_${randomUUID()}`,
      sourceStateKey: native.cartKey,
      items: [],
      revision: native.revision,
    };

    resolved.items = structuredClone(native.items);
    resolved.revision = native.revision;
    if (disclosed === undefined) {
      delete resolved.accountPrivate;
    } else {
      resolved.accountPrivate = structuredClone(disclosed);
    }

    if (existing === undefined) {
      this.#ucp.set(resolved.id, resolved);
      this.#association.set(native.cartKey, resolved.id);
    }
    return resolved;
  }

  /** Test/demo visibility into everything persisted. */
  allUcpCarts(): UcpCart[] {
    return [...this.#ucp.values()];
  }
}
