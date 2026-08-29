// Wires the four providers a Midnight dApp needs, against the local devnet.
//
//   proof     — the Docker proof server on :6300, where circuits actually prove
//   public    — the indexer, for reading ledger state
//   zkConfig  — the prover/verifier keys the compiler emitted
//   private   — LevelDB on disk, holding witnesses that never leave the machine

import { WebSocket } from 'ws';
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';

import { LOCAL, GENESIS_SEED, ZK_CONFIG_PATH } from './config.mjs';

// The indexer client wants a global WebSocket in Node.
globalThis.WebSocket = WebSocket;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
});

/** Build a funded wallet against the local devnet. */
export async function buildWallet({ seed = GENESIS_SEED, env = LOCAL } = {}) {
  setNetworkId(env.networkId);
  const wallet = await MidnightWalletProvider.build(
    logger,
    {
      walletNetworkId: env.networkId,
      networkId: env.networkId,
      indexer: env.indexer,
      indexerWS: env.indexerWS,
      node: env.node,
      nodeWS: env.nodeWS,
      faucet: env.faucet,
      proofServer: env.proofServer,
    },
    seed
  );
  await wallet.start();
  return wallet;
}

/**
 * The witness-store password. A repository-public fallback is permitted ONLY
 * against the local devnet, where the wallet seed is itself a published dev
 * fixture. Anywhere else, refuse to start without a real secret.
 */
function statePassword(env) {
  const fromEnv = process.env.NIGHTFOLD_STATE_PASSWORD;
  if (fromEnv) return fromEnv;
  if (env.networkId !== 'undeployed') {
    throw new Error(
      'NIGHTFOLD_STATE_PASSWORD is required outside the local devnet. ' +
      'The private state store holds hole cards and salts; refusing to ' +
      'encrypt it with a password published in this repository.'
    );
  }
  return 'Nightfold-Devnet-2026-local';
}

/** Assemble the provider bundle a contract call needs. */
export function buildProviders(wallet, { env = LOCAL, privateStateDir = '.nightfold-state' } = {}) {
  // Scopes the witness store to this wallet, so two players sharing a machine
  // never read each other's hole cards out of the same LevelDB.
  const accountId = wallet.coinPublicKey?.toString?.() ?? String(wallet.coinPublicKey ?? 'nightfold');

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: privateStateDir,
      // Encrypts the witness store — which holds hole cards and salts — at
      // rest. FAILS CLOSED off the local devnet (NF-009): the earlier version
      // silently fell back to a password published in this repository, so any
      // copied state directory was readable by anyone.
      privateStoragePasswordProvider: () => statePassword(env),
      accountId,
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider: new NodeZkConfigProvider(ZK_CONFIG_PATH),
    proofProvider: httpClientProofProvider(env.proofServer),
    walletProvider: wallet,
    midnightProvider: wallet,
  };
}
