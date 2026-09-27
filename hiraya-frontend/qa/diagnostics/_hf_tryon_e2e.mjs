/**
 * E2E PROOF: can this machine drive the yisol/IDM-VTON Space anonymously?
 * Flow under test (exactly what VtonApiRenderer will do in PHP):
 *   1. POST /upload           -> upload person + garment bytes (multipart, field "files")
 *   2. POST /call/tryon       -> submit 7 ordered inputs -> { event_id }
 *   3. GET  /call/tryon/{id}  -> SSE stream until event: complete | error
 *   4. Download the result FileData URL
 * Usage: node _hf_tryon_e2e.mjs <person.jpg> <garment.jpg>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'https://yisol-idm-vton.hf.space';
const PERSON = process.argv[2];
const GARMENT = process.argv[3];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

if (!PERSON || !GARMENT) {
  console.error('usage: node _hf_tryon_e2e.mjs <person.jpg> <garment.jpg>');
  process.exit(1);
}

/** Multipart upload, mirroring Gradio's own client (field name: "files"). */
async function upload(filePath, name) {
  const bytes = readFileSync(filePath);
  const form = new FormData();
  form.append('files', new Blob([bytes]), name);
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`upload ${name}: HTTP ${res.status} ${await res.text()}`);
  const [serverPath] = await res.json();
  log(`uploaded ${name} (${(bytes.length / 1024).toFixed(0)} KB) -> ${serverPath}`);
  return {
    path: serverPath,
    meta: { _type: 'gradio.FileData' },
    orig_name: name,
    mime_type: name.endsWith('.png') ? 'image/png' : 'image/jpeg',
    size: bytes.length,
  };
}

async function main() {
  const t0 = Date.now();

  const person = await upload(PERSON, 'person.jpg');
  const garment = await upload(GARMENT, 'garment.jpg');

  // The 7 ordered /tryon inputs, verified against the Space's /info schema.
  const payload = {
    data: [
      { background: person, layers: [], composite: null }, // dict (ImageEditor)
      garment,                                             // garm_img
      'off shoulder emerald a-line dress',                 // garment_des
      true,                                                // is_checked (auto-mask)
      true,                                                // is_checked_crop (auto-crop)
      30,                                                  // denoise_steps
      42,                                                  // seed
    ],
  };

  const submit = await fetch(`${BASE}/call/tryon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const submitText = await submit.text();
  if (!submit.ok) throw new Error(`submit: HTTP ${submit.status} ${submitText.slice(0, 300)}`);
  const { event_id: eventId } = JSON.parse(submitText);
  log(`submitted -> event_id ${eventId}`);

  // SSE stream. ZeroGPU queueing can take minutes; keep the connection open.
  const res = await fetch(`${BASE}/call/tryon/${eventId}`, { headers: { Accept: 'text/event-stream' } });
  log(`stream status ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalData = null;
  let finalEvent = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const evLine = chunk.split('\n').find((l) => l.startsWith('event:'));
      const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
      const ev = evLine ? evLine.slice(6).trim() : '';
      const data = dataLine ? dataLine.slice(5).trim() : '';
      if (ev && ev !== 'heartbeat') log(`SSE ${ev}: ${data.slice(0, 160)}`);
      if (ev === 'complete' || ev === 'error') {
        finalEvent = ev;
        finalData = data;
      }
    }
    if (finalEvent) break;
  }

  if (finalEvent === 'error') throw new Error(`Space returned error: ${finalData}`);
  if (!finalData) throw new Error('stream ended with no complete/error event');

  const outputs = JSON.parse(finalData);
  const resultFile = outputs[0]; // [output image, masked image]
  log(`result FileData: ${JSON.stringify(resultFile).slice(0, 200)}`);

  const url = resultFile.url
    ?? (resultFile.path.startsWith('http') ? resultFile.path : `${BASE}/file=${resultFile.path}`);
  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new Error(`result download: HTTP ${imgRes.status}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  writeFileSync('_hf_e2e_render.png', buf);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  log(`SUCCESS: saved _hf_e2e_render.png (${(buf.length / 1024).toFixed(0)} KB) in ${secs}s`);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
