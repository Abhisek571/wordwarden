// Smoke test in real Firefox: installs the built extension (`npm run build:firefox`) into a stock
// Firefox over WebDriver BiDi, opens the e2e fixture page in two tabs, and checks that typing in each
// gets underlines from the one shared checker. Playwright cannot load extensions in Firefox, so this
// talks to Firefox directly. Usage: node tests/firefox-smoke.mjs [path to firefox]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const FIREFOX_CANDIDATES = [
  process.argv[2],
  process.env.FIREFOX_BIN,
  'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
  '/usr/bin/firefox',
  '/snap/bin/firefox',
  '/Applications/Firefox.app/Contents/MacOS/firefox',
].filter((path) => typeof path === 'string' && existsSync(path));
const firefox = FIREFOX_CANDIDATES[0];
if (firefox === undefined) throw new Error('No Firefox found. Pass its path or set FIREFOX_BIN.');
const extensionPath = resolve('.output/firefox-mv3');
if (!existsSync(join(extensionPath, 'manifest.json'))) throw new Error('Run `npm run build:firefox` first.');

const freePort = () => new Promise((done) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => done(port));
  });
});
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const fixture = spawn(process.execPath, [resolve('tests/e2e/server.mjs')], { stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'wordwarden-firefox-'));
const port = await freePort();
const browser = spawn(firefox, ['--remote-debugging-port', String(port), '--profile', profile, '--no-remote', '--headless', 'about:blank'], { stdio: 'ignore' });

let socket = null;
let nextId = 1;
const pending = new Map();
async function connect() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
      await new Promise((ok, fail) => {
        ws.addEventListener('open', ok, { once: true });
        ws.addEventListener('error', fail, { once: true });
      });
      ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        const waiting = pending.get(message.id);
        if (waiting === undefined) return;
        pending.delete(message.id);
        if (message.type === 'error') waiting.fail(new Error(`${message.error}: ${message.message}`));
        else waiting.ok(message.result);
      });
      socket = ws;
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error('Firefox did not open its remote debugging port.');
}
const send = (method, params = {}) => new Promise((ok, fail) => {
  const id = nextId++;
  pending.set(id, { ok, fail });
  socket.send(JSON.stringify({ id, method, params }));
});
// Runs a function in the page and returns its plain result.
async function evaluate(context, functionDeclaration, ...args) {
  const result = await send('script.callFunction', {
    functionDeclaration,
    arguments: args.map((value) => ({ type: typeof value === 'number' ? 'number' : 'string', value })),
    target: { context },
    awaitPromise: true,
    resultOwnership: 'none',
  });
  if (result.type === 'exception') throw new Error(`Page script failed: ${result.exceptionDetails?.text}`);
  return result.result?.value;
}
async function waitFor(context, description, check, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < until) {
    if (await check()) return;
    const state = await evaluate(context, hostState);
    if (state !== last && process.env.WORDWARDEN_SMOKE_DEBUG) console.log(`  state ${state || '(no host)'}`);
    last = state;
    await sleep(250);
  }
  const details = await evaluate(context, `() => JSON.stringify({ host: document.getElementById('typecheck-root')?.dataset ?? null, focused: document.hasFocus(), active: document.activeElement?.id })`);
  throw new Error(`Timed out waiting for ${description}. Page: ${details}`);
}

const hostState = `() => {
  const host = document.getElementById('typecheck-root');
  return host === null ? '' : (host.dataset.state ?? '') + ':' + (host.dataset.issues ?? '');
}`;

async function checkTab(label, text) {
  const { context } = await send('browsingContext.create', { type: 'tab' });
  await send('browsingContext.navigate', { context, url: 'http://127.0.0.1:4173/', wait: 'complete' });
  // The content script arrives after the page has loaded; focusing before it listens does nothing.
  await waitFor(context, `${label}: the extension`, async () => (await evaluate(context, `() => document.getElementById('typecheck-root') !== null`)) === true);
  await evaluate(context, `(text) => { const box = document.getElementById('editor'); box.value = text; box.blur(); box.focus(); box.dispatchEvent(new Event('input', { bubbles: true })); }`, text);
  const started = Date.now();
  await waitFor(context, `${label}: underlines`, async () => (await evaluate(context, hostState)).startsWith('issues:'));
  const state = await evaluate(context, hostState);
  const issues = Number(state.split(':')[1]);
  console.log(`${label}: ${issues} issue(s) after ${Date.now() - started} ms`);
  if (issues < 1) throw new Error(`${label}: expected at least one issue, got ${state}`);
  await evaluate(context, `() => { const box = document.getElementById('editor'); box.value = 'This is a clean sentence.'; box.dispatchEvent(new Event('input', { bubbles: true })); }`);
  await waitFor(context, `${label}: clean text`, async () => (await evaluate(context, hostState)) === 'clear:0');
  console.log(`${label}: clean text shows no issues`);
  return context;
}

let failed = false;
try {
  await connect();
  await send('session.new', { capabilities: {} });
  await send('webExtension.install', { extensionData: { type: 'path', path: extensionPath } });
  console.log(`Installed the extension in ${firefox}`);
  // Two tabs, one after the other: the second must get its results from the checker the first started.
  await checkTab('tab 1', 'This are a test with a wrogn word.');
  await checkTab('tab 2', 'Me and him was going to the shop tomorow.');
  console.log('Firefox smoke test passed.');
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
} finally {
  socket?.close();
  browser.kill();
  fixture.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
