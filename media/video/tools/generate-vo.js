// Generate VO segments via ElevenLabs. Loads the API key from ../.env itself.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const API = 'https://api.elevenlabs.io/v1';
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('ELEVENLABS_API_KEY missing'); process.exit(1); }

const OUT = path.join(__dirname, '..', 'assets', 'vo');
const segments = JSON.parse(fs.readFileSync(path.join(__dirname, 'vo-segments.json'), 'utf8'));

// Documentary-narrator preference order if no voice id is pinned.
// Premade ElevenLabs voices have stable public IDs; the key is TTS-only
// (no voices_read), so we can't list — use known IDs directly.
const PREFERRED = [
  { name: 'George', voice_id: 'JBFqnCBsd6RMkjVDRZzb' },
  { name: 'Daniel', voice_id: 'onwK4e9ZLuTAKqWW03F9' },
  { name: 'Brian', voice_id: 'nPczCjzI2devNBz1zQrb' },
];

function pickVoice() {
  if (process.env.ELEVENLABS_VOICE_ID) return { voice_id: process.env.ELEVENLABS_VOICE_ID, name: '(from .env)' };
  return PREFERRED[0];
}

async function tts(voiceId, seg) {
  const res = await fetch(`${API}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: seg.text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`${seg.id}: ${res.status} ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(OUT, `${seg.id}.mp3`), buf);
  console.log(`${seg.id}: ${(buf.length / 1024).toFixed(0)} KB`);
}

(async () => {
  const voice = await pickVoice();
  console.log(`voice: ${voice.name} (${voice.voice_id})`);
  for (const seg of segments) {
    await tts(voice.voice_id, seg);
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('done');
})();
