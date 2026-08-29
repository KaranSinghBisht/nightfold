// What a chip costs, and why every chain has to agree about it.
//
// A chip is the unit of account. If the cage priced each asset independently
// the rates would disagree, and disagreeing rates are free money: buy chips
// where they are cheap, cash out where they are dear. So every rate is derived
// from one USD table rather than chosen per chain.
//
//     chipsPerToken(asset) = priceUsd(asset) / chipUsd
//
// A fixed table is a snapshot, and a snapshot goes stale — which is exactly
// why NightfoldCage takes an optional oracle. With one set, the cage tracks a
// posted rate and refuses to mint chips against a stale price. Without one,
// the published rate is fixed for the life of that cage and this file is what
// it was fixed to.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const table = JSON.parse(readFileSync(fileURLToPath(new URL('../pricing.json', import.meta.url)), 'utf8'));

export const CHIP_USD = table.chipUsd;
export const PRICES_USD = table.assets;
export const SNAPSHOT = table.snapshotUtc;

/** Chips per one whole unit of `asset`, as an integer. */
export function chipsPerToken(asset) {
  const usd = PRICES_USD[asset];
  if (usd === undefined) throw new Error(`no USD price for ${asset}`);
  const chips = usd / CHIP_USD;
  if (!Number.isInteger(chips)) throw new Error(`${asset} does not divide into whole chips at $${CHIP_USD}`);
  return BigInt(chips);
}

/** What `amount` whole units of `asset` is worth, in USD. */
export function usdOf(asset, amount) {
  return PRICES_USD[asset] * amount;
}

/** How many whole units of `asset` buy `chips`. */
export function unitsForChips(asset, chips) {
  return (Number(chips) * CHIP_USD) / PRICES_USD[asset];
}

/**
 * The exact wei that buys `chips`, rounded UP.
 *
 * The cage floors — `chips = amount * rate / 1e18` — so a float amount that is
 * a hair light buys one chip fewer. Doing the division in integers and
 * rounding up means the player gets the stack they asked for and the cage
 * keeps the dust, which is the right direction for the dust to go.
 */
export function weiForChips(asset, chips) {
  const rate = chipsPerToken(asset);
  const c = BigInt(chips);
  return (c * 10n ** 18n + rate - 1n) / rate;
}

/** What `chips` is worth, in USD. */
export function usdOfChips(chips) {
  return Number(chips) * CHIP_USD;
}
