import { Agent, SimulatedPlatformBinding, SimulatedTrustedIssuanceBridge } from '../src/agent.js';
import { Merchant } from '../src/merchant.js';
import type { BrowserSession, CartItem } from '../src/types.js';

export const PLATFORM_A = 'https://platform-a.example/profile';
export const PLATFORM_B = 'https://platform-b.example/profile';

export const BROWSER_COOKIE = 'sid=THIS_IS_A_BROWSER_SESSION_COOKIE_VALUE';

export function items(): CartItem[] {
  return [
    { sku: 'SKU-1', quantity: 2, unitPriceMinor: 1299, currency: 'USD', title: 'Cortado beans' },
    { sku: 'SKU-2', quantity: 1, unitPriceMinor: 4500, currency: 'USD', title: 'Pour-over kettle' },
  ];
}

export interface Harness {
  merchant: Merchant;
  bridge: SimulatedTrustedIssuanceBridge;
  session: BrowserSession;
  clock: { now: number };
}

export function harness(options: { platformProfile?: string } = {}): Harness {
  const clock = { now: 1_700_000_000_000 };
  const merchant = new Merchant({ now: () => clock.now });

  const session: BrowserSession = {
    sessionId: 'sess_1',
    userId: 'user_42',
    cartKey: 'cart_native_1',
    cookieValue: BROWSER_COOKIE,
  };
  merchant.putSession(session);

  merchant.carts.createNativeCart(session.cartKey, items(), {
    userId: 'user_42',
    savedPaymentMethodId: 'pm_secret_123',
    loyaltyNumber: 'LOY-999',
    internalRiskScore: 17,
  });

  void options;
  return {
    merchant,
    // Bound to the active browser context at construction; the session id never
    // reaches the agent-facing API.
    bridge: new SimulatedTrustedIssuanceBridge(merchant, session.sessionId),
    session,
    clock,
  };
}

export function agentFor(h: Harness, platformProfile?: string): Agent {
  return new Agent(
    h.bridge,
    platformProfile === undefined ? undefined : new SimulatedPlatformBinding(platformProfile),
  );
}
