// Independent UI-engine remediation verification. Audit evidence only.
import { cardName } from '../../../src/game/dealer.mjs';
import { resolveShowdown, startHand, view } from '../../../ui/src/game/engine.ts';
import { rankOf } from '../../../ui/src/game/rank.ts';
import { reveal } from '../../../ui/src/game/vault.ts';

let engine = startHand();
const actual = reveal(engine.handId) ?? [];
engine = resolveShowdown(engine, 1, 'show', rankOf);
const rendered = view(engine, 0).seats[1].hole ?? [];
const actualNames = actual.map(cardName).join(' ');
const renderedNames = rendered.map((card) => `${card.rank}${card.suit}`).join(' ');

if (actualNames === renderedNames) throw new Error('shown cards unexpectedly match');
console.log('BROKEN      opponent show renders the empty Engine slot', `— actual ${actualNames}, rendered ${renderedNames}`);
