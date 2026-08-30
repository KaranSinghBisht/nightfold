// Narrate the demo script with ElevenLabs.
//
// Writes one MP3 per block plus a continuous full read, because the blocks have
// to land on specific timestamps in the edit and a single take cannot be nudged.
//
//   export ELEVENLABS_API_KEY=sk_...      # never committed, never written to disk
//   node scripts/voiceover.mjs --voices   # list voices, pick one
//   node scripts/voiceover.mjs            # generate with the default voice
//   node scripts/voiceover.mjs --voice <id>
//
// Output: .demo-prep/vo/*.mp3  (gitignored)

import { mkdirSync, writeFileSync } from 'node:fs';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('ELEVENLABS_API_KEY is not set.\n' +
    '  export ELEVENLABS_API_KEY=sk_...   (the key itself, not the key ID —\n' +
    '  ElevenLabs shows it once at creation and it starts with sk_)');
  process.exit(1);
}
if (!KEY.startsWith('sk_')) {
  console.error(`That does not look like an ElevenLabs API key (got "${KEY.slice(0, 6)}…").\n` +
    '  Keys start with sk_. A bare hex string is the key ID, which the API rejects.');
  process.exit(1);
}

const OUT = '.demo-prep/vo';
const MODEL = 'eleven_multilingual_v2';

// The script, split the way the edit is cut. Timestamps are where each block
// starts in the 2:26 video.
// [timestamp, seconds until the NEXT visual change, text]
//
// Slots come from the frame-by-frame pass, not from guesses: 3 WAYS is on
// screen 0:16, THE MUCK PROTOCOL 0:24, EACH CHAIN 0:30, the lobby 0:36. The
// first cut gave the Midnight block 18s when the visual only holds for 14, so
// it ran over the next frame by five seconds.
const BLOCKS = [
  ['00-00', 16, 'In a real card room, when you lose, you muck. Cards face down, and nobody ever finds out what you had. Every poker game on a blockchain takes that away from you. This is Nightfold, built for the Midnight hackathon.'],
  ['00-16', 14, "Here's how we give it back. Your cards never leave your machine — they're Midnight witnesses. The chain sees a commitment and one number. And you pick what it says: your rank, a floor, or nothing."],
  ['00-30',  6, 'Six chains hold the money. Midnight holds the cards. Zero hole cards leaked.'],
  ['00-36', 18, "There's a guest table if you just want to play — but I'll take the cash lane, because that's where the interesting part is. Connecting a wallet now, and from here everything's a real transaction."],
  ['00-54', 14, 'Six chains, one price table. A chip is twenty cents no matter what you bring — rates that disagree are free money for whoever spots it. And this is a real payable call into the cage.'],
  ['01-08', 22, 'Now watch this feed. Bob bought in with SOL. I bought in with ETH. Same table, same stack — and every bet is tagged with the chain it actually settled on. In between them, Midnight, holding the deal. <break time="0.7s" /> Three chains, one hand.'],
  ['01-30', 12, "I had a flush. <break time=\"0.8s\" /> And I mucked it. Look what Midnight wrote down — seat zero concedes. Cards redacted. Rank redacted. It was never published."],
  ['01-42', 10, "Four ninety left, and the cage doesn't care which chain any of it came from. That's the whole point."],
  ['01-52', 14, "I came in on Base. I'm leaving on Solana — a chain I never deposited to. The chips burn here first, so the same stack can't be spent twice."],
  ['02-06', 16, 'And there it is. Solana devnet, finalized. Point nine four eight SOL out of the cage, into my wallet — four ninety chips at twenty cents, down to the lamport. That link is public.'],
  ['02-22',  4, 'Any chain in, any chain out. The losing hand, never.'],
];

/**
 * Candidates, all conversational rather than broadcast-announcer — a two-minute
 * technical read in a movie-trailer voice sounds like an advert.
 *
 * Hard-coded because this key lacks voices_read; these are ElevenLabs' public
 * premade voice ids.
 */
const VOICES = {
  chris:  ['iP95p4xoKVk53GoZ742B', 'casual, conversational American male'],
  will:   ['bIHbv24MWmeRgasZH58o', 'friendly, relaxed American male'],
  liam:   ['TX3LPaxmHKxFdv7VOQHJ', 'younger American male, energetic'],
  eric:   ['cjVigY5qzO86Huf0OWal', 'warm American male, even pace'],
  jessica:['cgSgspJ2msm6clMCkdW9', 'expressive American female'],
  laura:  ['FGY2WhTYpPnrIDTdsKH5', 'upbeat American female'],
  george: ['JBFqnCBsd6RMkjVDRZzb', 'British, warm narration'],
  antoni: ['ErXwobaYiN019PkySvjV', 'warm, well-rounded'],
};
const DEFAULT_VOICE = VOICES.chris[0];

/** 128 kbps mono mp3 -> bytes/16000 is seconds, close enough to judge fit. */
const secondsOf = (buf) => buf.length / 16000;

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function listVoices() {
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': KEY } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const { voices } = await res.json();
  for (const v of voices) {
    const l = v.labels ?? {};
    console.log(`  ${v.voice_id}  ${v.name.padEnd(14)} ${[l.accent, l.gender, l.age, l.description].filter(Boolean).join(', ')}`);
  }
}

async function speak(text, voice) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      // Stability low enough to sound spoken, high enough not to wander;
      // style at 0 because a demo read should not perform.
      voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

if (process.argv.includes('--voices')) {
  await listVoices().catch((e) => {
    console.log(`  (account listing unavailable: ${e.message.slice(0, 80)})\n  built-in candidates:`);
    for (const [name, [id, desc]] of Object.entries(VOICES)) {
      console.log(`    ${name.padEnd(8)} ${id}  ${desc}`);
    }
  });
  process.exit(0);
}

// --samples: one line in every candidate voice, so the choice is made by ear.
if (process.argv.includes('--samples')) {
  const line = 'In a real card room, when you lose, you muck. Cards face down, and nobody ever finds out what you had.';
  mkdirSync(`${OUT}/samples`, { recursive: true });
  for (const [name, [id, desc]] of Object.entries(VOICES)) {
    const audio = await speak(line, id);
    writeFileSync(`${OUT}/samples/${name}.mp3`, audio);
    console.log(`  ${name.padEnd(8)} ${secondsOf(audio).toFixed(1)}s  ${desc}`);
  }
  console.log(`\n  ${OUT}/samples/ — listen, then: npm run voiceover -- --voice <id>`);
  process.exit(0);
}

const voice = arg('--voice') ?? DEFAULT_VOICE;
mkdirSync(OUT, { recursive: true });
console.log(`voice ${voice}, model ${MODEL}\n`);

let over = 0;
for (const [stamp, slot, text] of BLOCKS) {
  const audio = await speak(text, voice);
  writeFileSync(`${OUT}/${stamp}.mp3`, audio);
  const secs = secondsOf(audio);
  const fits = secs <= slot;
  if (!fits) over++;
  console.log(`  ${stamp}  ${secs.toFixed(1).padStart(5)}s / ${String(slot).padStart(2)}s slot  ` +
              `${fits ? 'fits' : `OVER by ${(secs - slot).toFixed(1)}s`}`);
}

// One continuous read, for a straight lay-down if the per-block edit is too fiddly.
const full = BLOCKS.map(([, , t]) => t).join(' <break time="0.6s" /> ');
const fullAudio = await speak(full, voice);
writeFileSync(`${OUT}/full.mp3`, fullAudio);
console.log(`\n  full.mp3  ${secondsOf(fullAudio).toFixed(1)}s continuous  (video is 146s)`);
if (over) console.log(`  ${over} block(s) run past their slot — trim those lines or widen the gap in the edit.`);
