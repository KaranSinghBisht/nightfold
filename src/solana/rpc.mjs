// Solana JSON-RPC over plain fetch.
//
// Deliberately dependency-free. The watcher only ever READS the chain, and
// reading it is four HTTP calls — pulling a whole SDK in to make them would put
// a large dependency on the one path that has to keep running in production.
// Sending a transaction needs signing and a real library; that lives in the
// tests, as a devDependency.

export const DEVNET = 'https://api.devnet.solana.com';

export class SolanaRpcError extends Error {
  constructor(method, detail) {
    // No response bodies in the message: an RPC error can echo request content,
    // and this string ends up in logs.
    super(`solana ${method} failed: ${detail}`);
    this.name = 'SolanaRpcError';
    this.method = method;
  }
}

/**
 * One JSON-RPC call, with a timeout and a bounded read.
 * @param {string} method
 * @param {unknown[]} params
 * @param {{ url?: string, timeoutMs?: number }} [opts]
 */
export async function rpc(method, params = [], opts = {}) {
  const { url = DEVNET, timeoutMs = 20_000 } = opts;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new SolanaRpcError(method, err.name === 'TimeoutError' ? 'timed out' : 'unreachable');
  }

  if (!res.ok) throw new SolanaRpcError(method, `HTTP ${res.status}`);

  const body = await res.json();
  if (body.error) throw new SolanaRpcError(method, `code ${body.error.code}`);
  return body.result;
}

/** Is devnet reachable right now? Used to skip live tests rather than fail them. */
export async function reachable(url = DEVNET) {
  try {
    await rpc('getVersion', [], { url, timeoutMs: 8_000 });
    return true;
  } catch {
    return false;
  }
}
