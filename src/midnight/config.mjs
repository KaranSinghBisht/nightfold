// Endpoints for the local devnet brought up by scripts/devnet.sh.
//
// `undeployed` is the network id a local Midnight node reports. It is also the
// network Lace targets in its "Undeployed" mode, so a browser wallet can point
// at this same stack.

export const LOCAL = {
  networkId: 'undeployed',
  // v4, per midnight-local-dev's own dApp example. v3 also answers 200 on
  // indexer 4.3.3, which is why this was wrong for so long without looking it.
  indexer: 'http://127.0.0.1:8088/api/v4/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  node: 'http://127.0.0.1:9944',
  nodeWS: 'ws://127.0.0.1:9944',
  // MIDNIGHT_PROOF_SERVER lets scripts/proof-proxy.mjs sit in front and print
  // the rejection bodies the SDK swallows.
  proofServer: process.env.MIDNIGHT_PROOF_SERVER ?? 'http://127.0.0.1:6300',
  faucet: '',
};

/** Genesis-funded seed on a dev-preset node. */
export const GENESIS_SEED =
  '0000000000000000000000000000000000000000000000000000000000000001';

export const ZK_CONFIG_PATH = 'contracts/managed/nightfold';
