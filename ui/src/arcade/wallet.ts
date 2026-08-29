/**
 * Wallet connection, honestly.
 *
 * If the browser has an EIP-1193 provider we ask it for an account and use the
 * real address. If it does not — which is most people opening a demo — we fall
 * back to a clearly-labelled demo account rather than pretending. The UI shows
 * which one it got; nothing here ever claims a signature it did not obtain.
 */

export type WalletKind = 'injected' | 'demo';

export interface Wallet {
  address: string;
  kind: WalletKind;
}

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function provider(): Eip1193 | undefined {
  const injected = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  return typeof injected?.request === 'function' ? injected : undefined;
}

export function hasInjectedWallet(): boolean {
  return provider() !== undefined;
}

/**
 * A stable stand-in so the demo is reproducible, not a random each reload.
 *
 * EIP-55 checksummed — the first version of this was hand-typed and failed
 * checksum validation, which every serious tool enforces. An address nobody can
 * paste anywhere is a bad stand-in for an address.
 */
const DEMO_ADDRESS = '0x9F2cA1E4B6d3705e8AC0f2b21B4Dd7C0E1a94d81';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function connect(): Promise<Wallet> {
  const eth = provider();
  if (!eth) return { address: DEMO_ADDRESS, kind: 'demo' };

  try {
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    const first = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof first === 'string' && ADDRESS.test(first)) {
      return { address: first, kind: 'injected' };
    }
    return { address: DEMO_ADDRESS, kind: 'demo' };
  } catch {
    // A rejected connection is a choice, not an error worth surfacing raw.
    return { address: DEMO_ADDRESS, kind: 'demo' };
  }
}

export function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
