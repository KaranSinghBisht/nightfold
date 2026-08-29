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

/** Assemble the provider bundle a contract call needs. */
export function buildProviders(wallet, { env = LOCAL, privateStateDir = '.nightfold-state' } = {}) {
  // Scopes the witness store to this wallet, so two players sharing a machine
  // never read each other's hole cards out of the same LevelDB.
  const accountId = wallet.coinPublicKey?.toString?.() ?? String(wallet.coinPublicKey ?? 'nightfold');

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: privateStateDir,
      // Encrypts the witness store at rest. This is a local devnet, so the
      // password comes from the environment with a dev fallback rather than
      // being hardcoded for real use.
      privateStoragePasswordProvider: () =>
        process.env.NIGHTFOLD_STATE_PASSWORD ?? 'nightfold-local-devnet-key',
      accountId,
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider: new NodeZkConfigProvider(ZK_CONFIG_PATH),
    proofProvider: httpClientProofProvider(env.proofServer),
    walletProvider: wallet,
    midnightProvider: wallet,
  };
}
