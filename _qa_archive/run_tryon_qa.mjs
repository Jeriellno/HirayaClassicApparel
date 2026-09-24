/**
 * TRY-ON QA LAUNCHER
 * ==================
 *
 * Boots the Hiraya frontend, runs a page-driver script against it, and exits
 * with a real status code so it can gate CI.
 *
 *   node run_tryon_qa.mjs qa_tryon_constraints.mjs            # score only
 *   node run_tryon_qa.mjs qa_tryon_constraints.mjs --capture   # + save the render
 *   node run_tryon_qa.mjs                                      # defaults to the validator
 *
 *   --portrait=FILE   score against a real photo instead of the synthetic figure
 *   --capture         write the render to qa_tryon_render.png
 *   --insecure        disable web security (NOT recommended — see launchBrowser;
 *                     the permissive default once hid a canvas-taint bug that
 *                     broke the Studio's export while QA reported a clean pass)
 *
 * WHY A LAUNCHER AND NOT A PLAIN `node script.mjs`
 * ------------------------------------------------
 * The constraint validator must run the app's real `compositeTryOn()` in a
 * browser: it imports `/src/utils/compositeTryOn.js`, uses `document.createElement`,
 * `Image`, canvas pixel reads and `@imgly/background-removal`. None of that
 * exists in bare Node. So we start Vite, attach a headless browser, and hand the
 * script a `page`.
 *
 * EXIT CODES
 *   0  every constraint passed
 *   1  at least one constraint FAILED
 *   2  the harness could not run at all (no browser, app never came up)
 *
 * `skipped` counts as NOT passing: an unverifiable constraint must never be
 * reported as a green build.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { connect as netConnect } from 'node:net';
import path from 'node:path';

const ROOT = process.env.QA_ROOT || 'C:/hiraya';
const FRONTEND = path.join(ROOT, 'hiraya-frontend');
const PORT = Number(process.env.QA_PORT || 5199);
const BASE = `http://localhost:${PORT}`;

const args = process.argv.slice(2);
const capture = args.includes('--capture');
/**
 * Opt IN to disabling web security. Deliberately not the default — see
 * launchBrowser() for the shipped bug that the permissive default concealed.
 */
const insecure = args.includes('--insecure');
const portraitArg = args.find((a) => a.startsWith('--portrait='));
const scriptArg = args.find((a) => !a.startsWith('--')) || 'qa_tryon_constraints.mjs';
const scriptPath = path.isAbsolute(scriptArg) ? scriptArg : path.join(ROOT, scriptArg);

/**
 * Load the operator's portrait as a data URI for injection into the page.
 *
 * A data URI required rather than a file path: the harness calls
 * `getImageData` on the render, and reading a `file://` image into a canvas
 * taints it, which would turn every pixel check into `skipped`.
 */
const loadPortraitDataUri = () => {
  if (!portraitArg) return { dataUri: null, source: null };

  const p = portraitArg.slice('--portrait='.length).replace(/^"|"$/g, '');
  const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
  if (!existsSync(abs)) fail(2, 'Portrait not found: ' + abs);

  const ext = path.extname(abs).toLowerCase();
  const mime =
    ext === '.png' ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
    : null;
  if (!mime) {
    fail(2, 'Unsupported portrait format "' + ext + '". Use .png, .jpg or .webp.');
  }

  const buf = readFileSync(abs);
  if (!buf.length) fail(2, 'Portrait is empty: ' + abs);

  return { dataUri: 'data:' + mime + ';base64,' + buf.toString('base64'), source: abs, bytes: buf.length };
};

const portrait = loadPortraitDataUri();

const fail = (code, msg) => {
  console.error('\n  ' + msg + '\n');
  process.exit(code);
};

if (!existsSync(scriptPath)) {
  fail(2, `Harness not found: ${scriptPath}`);
}

/* ---------------- 1. Start Vite ---------------- */
/*
 * Resolve the Vite binary DIRECTLY rather than shelling out to `npx`.
 * Node is frequently installed via nvm/volta, so `npx` is often absent from
 * PATH in a fresh shell even though the project's node_modules is intact. The
 * local vite JS entry is the reliable target and needs no PATH at all.
 */
const viteEntry = path.join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(viteEntry)) {
  fail(2, 'Vite not installed. Run: cd hiraya-frontend; npm install\n  (looked for ' + viteEntry + ')');
}

const vite = spawn(process.execPath, [viteEntry, '--port', String(PORT), '--strictPort'], {
  cwd: FRONTEND,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let viteLog = '';
vite.stdout.on('data', (d) => { viteLog += d.toString(); });
vite.stderr.on('data', (d) => { viteLog += d.toString(); });
vite.on('error', (e) => fail(2, 'Could not start Vite: ' + e.message));

const waitForServer = async (timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE, { method: 'GET' });
      if (r.ok || r.status === 404) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

const shutdown = () => {
  try { vite.kill(); } catch { /* already gone */ }
};
process.on('exit', shutdown);

const up = await waitForServer();
if (!up) {
  shutdown();
  fail(2, 'Vite never became reachable on ' + BASE + '\n--- vite output ---\n' + viteLog);
}

/* ---------------- 2. Connect to a browser over CDP ---------------- */
/*
 * NO NEW DEPENDENCY.
 *
 * Puppeteer/Playwright are not in package.json and downloading Chromium is a
 * ~120 MB one-time cost we do not need: Chrome and Edge are already on this
 * machine. The CDP (Chrome DevTools Protocol) endpoint each one exposes gives us
 * exactly the two things the harness needs — `Runtime.evaluate` to run the
 * analysis in the page, and `Log`/`Runtime.exceptionThrown` for page errors.
 *
 * We implement the tiny slice of the protocol we use rather than pulling in a
 * driver, so `node run_tryon_qa.mjs` works on a fresh checkout.
 */
const findBrowser = () => {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
};

const browserPath = findBrowser();
if (!browserPath) {
  shutdown();
  fail(
    2,
    [
      'No Chrome/Edge binary found.',
      '',
      'The constraints are pixel-level assertions, so they must run in a real browser.',
      'Set CHROME_PATH to a Chromium-based browser and re-run:',
      '',
      '    $env:CHROME_PATH="C:\\path\\to\\chrome.exe"; node run_tryon_qa.mjs',
      '',
      '    (or: cd hiraya-frontend; npm i -D puppeteer-core  and set CHROME_PATH)',
    ].join('\n')
  );
}

/* ---------------- 3. Launch + page driver ---------------- */
const DEBUG_PORT = PORT + 1;
let browserProc;

const launchBrowser = async () => {
  const userDataDir = path.join(ROOT, '.qa-chrome-profile');
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + userDataDir,
    '--window-size=1280,1600',
    /*
     * WEB SECURITY IS ON BY DEFAULT, AND THAT DEFAULT IS THE POINT.
     *
     * This used to pass `--disable-web-security` unconditionally, which made the
     * harness MORE PERMISSIVE than the browser the customer actually uses. That
     * is not a small difference — it HID A SHIPPED DEFECT. Garment images tainted
     * the canvas (no CORS attribute was set), `canvas.toDataURL()` threw in
     * production, and the Studio showed "FITTING INTERRUPTED" while every QA run
     * reported a clean pass. The harness was measuring a world where cross-origin
     * reads always succeed.
     *
     * So strict security is now the default: the harness sees what the customer
     * sees. `--insecure` restores the old permissive behaviour for the narrow case
     * of probing a host that genuinely does not serve CORS, where the goal is to
     * diagnose the fallback path rather than to validate the product.
     */
    'about:blank',
  ];

  if (insecure) {
    args.splice(args.length - 1, 0, '--disable-web-security', '--allow-running-insecure-content');
  }

  browserProc = spawn(browserPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  browserProc.on('error', (e) => fail(2, 'Could not launch ' + browserPath + ': ' + e.message));

  // Poll the DevTools HTTP endpoint for the target list.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      if (r.ok) {
        const list = await r.json();
        const target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (target) return target;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('DevTools endpoint never became available on port ' + DEBUG_PORT);
};

/* ------------------------------------------------------------------ *
 * MINIMAL WEBSOCKET CLIENT (RFC 6455, client role)
 *
 * Node 20 has no global `WebSocket` (it landed in 22 behind a flag). Rather
 * than add a `ws` dependency for one socket, this implements the small slice the
 * DevTools Protocol needs: a masked text write, and fragmented read frames.
 *
 * Deliberately conservative: it handles text/binary/close/ping and buffers
 * multi-frame messages, but does no compression (CDP does not use
 * permessage-deflate unless the server offers it, and we never request it).
 * ------------------------------------------------------------------ */
const wsConnect = (wsUrl) =>
  new Promise((resolve, reject) => {
    const u = new URL(wsUrl);
    const key = randomBytes(16).toString('base64');
    const socket = netConnect({ host: u.hostname, port: Number(u.port || 80) });

    const listeners = [];
    const pending = new Map();
    let id = 0;
    let buffer = Buffer.alloc(0);
    let fragment = [];
    let handshakeDone = false;

    const encodeFrame = (text) => {
      const payload = Buffer.from(text, 'utf8');
      const len = payload.length;
      let header;
      if (len < 126) {
        header = Buffer.alloc(2);
        header[1] = 0x80 | len;
      } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[1] = 0x80 | 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }
      header[0] = 0x81; // FIN + text opcode
      const mask = randomBytes(4);
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
      return Buffer.concat([header, mask, masked]);
    };

    const handleMessage = (raw) => {
      if (!handshakeDone) {
        const text = raw.toString('latin1');
        if (!/^HTTP\/1\.1 101/.test(text)) {
          reject(new Error('CDP websocket handshake failed: ' + text.split('\r\n')[0]));
          return;
        }
        handshakeDone = true;
        resolve({
          send(method, params = {}) {
            const msgId = ++id;
            socket.write(encodeFrame(JSON.stringify({ id: msgId, method, params })));
            return new Promise((res, rej) => pending.set(msgId, { res, rej }));
          },
          on(fn) {
            listeners.push(fn);
          },
          close() {
            try { socket.destroy(); } catch { /* ignore */ }
          },
        });
        // Anything after the handshake headers is the first frame.
        const rest = raw.subarray(raw.indexOf('\r\n\r\n') + 4);
        if (rest.length) parseFrames(rest);
        return;
      }
      parseFrames(raw);
    };

    const parseFrames = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < 2) return;
        const fin = (buffer[0] & 0x80) !== 0;
        const opcode = buffer[0] & 0x0f;
        let len = buffer[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buffer.length < 4) return;
          len = buffer.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buffer.length < 10) return;
          len = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        if (buffer.length < offset + len) return;

        const payload = buffer.subarray(offset, offset + len);
        buffer = buffer.subarray(offset + len);

        if (opcode === 0x8) {
          socket.destroy();
          return;
        }
        if (opcode === 0x9) {
          // ping -> pong (masked, per the client role)
          const mask = randomBytes(4);
          const masked = Buffer.alloc(payload.length);
          for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
          socket.write(Buffer.concat([Buffer.from([0x8a, 0x80 | payload.length]), mask, masked]));
          continue;
        }
        if (opcode === 0xa) continue;

        fragment.push(payload);
        if (!fin) continue;

        const text = Buffer.concat(fragment).toString('utf8');
        fragment = [];

        let msg;
        try { msg = JSON.parse(text); } catch { continue; }

        if (msg.id && pending.has(msg.id)) {
          const { res, rej } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message || 'CDP error'));
          else res(msg.result);
        } else if (msg.method) {
          listeners.forEach((fn) => fn(msg));
        }
      }
    };

    socket.on('connect', () => {
      socket.write(
        'GET ' + u.pathname + (u.search || '') + ' HTTP/1.1\r\n' +
          'Host: ' + u.host + '\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' + key + '\r\n' +
          'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });
    socket.on('data', handleMessage);
    socket.on('error', (e) => reject(new Error('CDP socket error: ' + e.message)));
    socket.on('close', () => {
      if (!handshakeDone) reject(new Error('CDP socket closed before handshake'));
    });

    // Pending calls must not hang forever if the browser dies mid-run.
    setTimeout(() => {
      if (!handshakeDone) reject(new Error('CDP handshake timed out'));
    }, 20000).unref?.();
  });

const connectCdp = (wsUrl) => wsConnect(wsUrl);

let cdp;
let page;

const makePage = (client) => {
  const pageErrors = [];
  client.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params?.exceptionDetails;
      pageErrors.push(d?.exception?.description || d?.text || 'exception');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      pageErrors.push('console: ' + text);
    }
  });

  const evaluate = async (fnOrSource, arg) => {
    // Puppeteer-style: a function is serialised, an expression is used verbatim.
    const expr =
      typeof fnOrSource === 'function'
        ? `(${fnOrSource})(${arg === undefined ? '' : JSON.stringify(arg)})`
        : fnOrSource;

    const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });

    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || 'evaluate threw');
    }
    return result?.value;
  };

  return {
    errors: pageErrors,
    evaluate,
    async goto(url) {
      await client.send('Page.enable');
      await client.send('Page.navigate', { url });
      // Wait for the load event, then a settle period for Vite's module graph.
      await new Promise((r) => setTimeout(r, 3500));
    },
    on() { /* errors are collected above */ },
  };
};

try {
  const target = await launchBrowser();
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable').catch(() => {});
  page = makePage(cdp);

  await page.goto(BASE);

  // Fail fast and loudly if the app did not actually load.
  const title = await page.evaluate('document.title').catch(() => null);
  const bodyLen = await page.evaluate('document.body ? document.body.innerHTML.length : 0').catch(() => 0);
  if (!bodyLen) {
    throw new Error('page loaded empty from ' + BASE + ' — is the Vite root the frontend?');
  }
  console.log('  app loaded: "' + (title || '(untitled)') + '" (' + bodyLen + ' chars of DOM)');
  console.log(
    '  portrait:   ' + (portrait.source ? portrait.source + ' (' + Math.round(portrait.bytes / 1024) + ' KB)' : 'none supplied — using the synthetic figure')
  );

  /* ---------------- 4. Run the harness ---------------- */
  const mod = await import(pathToFileURL(scriptPath).href);
  if (typeof mod.default !== 'function') {
    throw new Error(scriptPath + ' has no default-exported run(page) function');
  }

  const result = await mod.default(page, {
    capture,
    base: BASE,
    portraitDataUri: portrait.dataUri,
  });

  if (result.report) console.log(result.report);
  else console.log(JSON.stringify(result, null, 2));

  const pageErrors = page.errors || [];
  if (pageErrors.length) {
    console.log('  page errors during run (' + pageErrors.length + '):');
    pageErrors.slice(0, 10).forEach((e) => console.log('    - ' + String(e).split('\n')[0]));
  }

  /* ---------------- 5. Exit status ---------------- */
  /*
   * A GREEN BUILD REQUIRES POSITIVE EVIDENCE.
   *
   * The previous version read `result.ok` and printed "all four constraints
   * satisfied". That was wrong. `ok` is whatever the harness returns, and a
   * DIAGNOSTIC script (a trace, a dump, a probe) legitimately returns `ok: true`
   * to mean "I ran successfully" — not "the fitting is correct". Running the
   * silhouette trace through this launcher reported PASS for a script that
   * asserts nothing at all.
   *
   * PASS now requires the harness to declare itself a constraint check
   * (`kind: 'constraints'`) AND report at least one check, all passing, none
   * skipped. Anything else is explicitly NOT a pass — it is a no-verdict run.
   */
  const kind = result.kind || null;
  const checkCount = Array.isArray(result.checks) ? result.checks.length : 0;

  if (result.fatal || (kind === 'constraints' && !result.ok)) {
    const failed = result.failed || 0;
    const skipped = result.skipped || 0;
    const why = result.fatal
      ? 'the harness could not produce a render to check'
      : failed + ' constraint(s) failed' + (skipped ? ', ' + skipped + ' could not be verified' : '');
    console.log('  RESULT: FAIL — ' + why + '\n');
    process.exitCode = 1;
  } else if (kind === 'constraints' && checkCount > 0 && result.ok) {
    console.log('  RESULT: PASS — all ' + checkCount + ' constraints satisfied\n');
    process.exitCode = 0;
  } else {
    console.log(
      '  RESULT: NO VERDICT — this script does not assert that the fitting is correct' +
        (kind ? ' (kind: ' + kind + ')' : ' (no `kind` declared)') +
        '.\n  It ran successfully, which is not the same thing.\n'
    );
    process.exitCode = 0;
  }
} catch (e) {
  console.error('\n  Launcher error: ' + (e?.stack || e?.message || String(e)) + '\n');
  process.exitCode = 2;
} finally {
  try { cdp?.close(); } catch { /* ignore */ }
  try { browserProc?.kill(); } catch { /* ignore */ }
  shutdown();
  // Let stdio flush before the process exits.
  await new Promise((r) => setTimeout(r, 300));
  process.exit(process.exitCode ?? 0);
}
