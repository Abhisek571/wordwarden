// Measures the memory and CPU the built Chromium extension, Harper's browser extension and a LanguageTool server
// use for the same text, then draws docs/resources.svg. Needs `npm run build` and Playwright's Chromium first.
// Usage: node scripts/resource-chart.mjs <LanguageTool folder> [report.json] [out.svg]
// with WORDWARDEN_HARPER_EXTENSION set to the unpacked harper-chrome-plugin.zip to include Harper.
// Given a saved report instead of the folder, it only redraws the chart from it.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const [languageToolArg, reportPath, outArg] = process.argv.slice(2);
if (languageToolArg === undefined) throw new TypeError('Expected the LanguageTool folder or a saved report.');
const redrawOnly = languageToolArg.endsWith('.json');
// The download unpacks to LanguageTool-<version>/ inside the given folder.
const languageToolDir = redrawOnly ? null : [languageToolArg, ...readdirSync(languageToolArg).map((name) => join(languageToolArg, name))]
  .find((path) => existsSync(join(path, 'languagetool-server.jar')));
if (languageToolDir === undefined) throw new Error(`No languagetool-server.jar in ${languageToolArg}.`);
const extensionDir = resolve('.output/chrome-mv3');
const RUNS = 30;
const MANY_TABS = 20;
// Checks before timing, then a pause, so start-up work (such as Java compiling hot code) is not counted per check.
const WARM_UP = 3;
const SETTLE_MS = 5000;
const LT_PORT = 8097;
const PARAGRAPH = 'I recieve alot of questions about hiking, so here is my advice. Their is no need for expensive gear when you start. A good pair of boots and a warm jacket goes a long way. Always check the weather befor you leave, and tell a friend were you are going. Me and my friend was going to the mountains last year, but we doesnt know the trail. We walked for nearly two hour before someone tell us the path had already closed.';
const TEXT = Array.from({ length: 6 }, () => PARAGRAPH).join(' ');
// Each timed check numbers every sentence afresh, so neither checker has seen any sentence before: Wordwarden keeps
// the findings of text that did not change, and this measures checking new text.
let serial = 0;
const freshText = () => TEXT.replace(/[.?!](?= |$)/gu, (mark) => ` ${(serial += 1)}${mark}`);
const WORDS = freshText().split(/\s+/u).length;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Private memory (bytes) and CPU time (seconds, all cores) of every process whose command line matches. */
function processes(matches) {
  if (process.platform === 'win32') {
    const script = 'Get-CimInstance Win32_Process | ForEach-Object { "{0}`t{1}`t{2}`t{3}" -f $_.ProcessId, $_.PrivatePageCount, ($_.UserModeTime + $_.KernelModeTime), $_.CommandLine }';
    return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 64 << 20 })
      .split(/\r?\n/u).map((line) => line.split('\t')).filter((row) => row.length >= 4 && matches(row.slice(3).join('\t')))
      .map(([pid, bytes, ticks]) => ({ pid: Number(pid), bytes: Number(bytes), cpu: Number(ticks) / 1e7 }));
  }
  const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }));
  return readdirSync('/proc').filter((name) => /^\d+$/u.test(name)).flatMap((pid) => {
    try {
      if (!matches(readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' '))) return [];
      const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
      const kb = [...rollup.matchAll(/^Private_(?:Clean|Dirty):\s+(\d+)/gmu)].reduce((sum, match) => sum + Number(match[1]), 0);
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
      return [{ pid: Number(pid), bytes: kb * 1024, cpu: (Number(stat[11]) + Number(stat[12])) / ticksPerSecond }];
    } catch {
      return []; // The process ended while it was being read.
    }
  });
}
const total = (rows) => ({ mb: rows.reduce((sum, row) => sum + row.bytes, 0) / 1048576, cpu: rows.reduce((sum, row) => sum + row.cpu, 0) });

function folderMb(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.size / 1048576;
  return readdirSync(path).reduce((sum, name) => sum + folderMb(join(path, name)), 0);
}

// The extensions measured, each the same way. Harper is its newest release's unpacked harper-chrome-plugin.zip,
// given in WORDWARDEN_HARPER_EXTENSION; without it, Harper is left out.
const harperDir = process.env.WORDWARDEN_HARPER_EXTENSION ?? null;
const EXTENSIONS = {
  wordwarden: {
    dir: extensionDir,
    // Underlines are in a closed shadow root, so they are counted through the DevTools protocol.
    isMark: (attributes) => attributes.includes('data-testid\0issue-mark'),
    message: (text) => ({ type: 'engine:lint', text }),
    issues: (answer) => {
      if (!answer.ok) throw new Error(answer.error);
      return answer.issues.length;
    },
  },
  ...(harperDir === null ? {} : {
    harper: {
      dir: resolve(harperDir),
      isMark: (attributes) => /(?:^|\0)id\0harper-highlight(?:\0|$)/u.test(attributes),
      message: (text) => ({ kind: 'lint', text, domain: 'a.example', options: { language: 'plaintext' } }),
      issues: (answer) => Object.values(answer.lints).reduce((sum, lints) => sum + lints.length, 0),
      // Harper checks only a list of sites until checking everywhere is switched on, as a user would.
      prepare: (page) => page.evaluate(() => chrome.runtime.sendMessage({ kind: 'setDefaultStatus', enabled: true })),
    },
  }),
};

/** A browser with the named extension, or none; pages on *.example get the test text and other sites are refused. */
async function launchBrowser(name) {
  const dir = name === null ? null : EXTENSIONS[name].dir;
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: dir === null ? [] : [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  const html = `<!doctype html><meta charset="utf-8"><textarea id="editor" style="width:900px;height:500px">${TEXT}</textarea><button id="away">x</button>`;
  // Refusing other sites also stops a welcome page opened on install from loading.
  await context.route(/^https?:\/\//u, (route) => (/^https:\/\/[a-z]\.example\//u.test(route.request().url())
    ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort()));
  let id = null;
  if (dir !== null) {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    id = new URL(worker.url()).hostname;
    if (EXTENSIONS[name].prepare) {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/options.html`);
      await EXTENSIONS[name].prepare(page);
      await page.close();
    }
  }
  return { context, id };
}
const browserProcesses = () => processes((command) => command.includes('ms-playwright') && command.includes('chrom'));

async function markCount(cdp, name) {
  const { nodes } = await cdp.send('DOM.getFlattenedDocument', { depth: -1, pierce: true });
  return nodes.filter((node) => EXTENSIONS[name].isMark((node.attributes ?? []).join('\0'))).length;
}

/** The browser's memory and CPU after `tabs` tabs have each been focused and, with an extension, underlined. */
async function tabsRun(name, tabs) {
  const { context } = await launchBrowser(name);
  const pages = [];
  for (const host of 'abcdefghijklmnopqrstuvwxyz'.slice(0, tabs)) {
    const page = await context.newPage();
    await page.goto(`https://${host}.example/`);
    pages.push(page);
  }
  for (const page of context.pages()) if (!pages.includes(page)) await page.close();
  for (const page of pages) {
    await page.bringToFront();
    await page.locator('#editor').click();
    if (name !== null) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('DOM.enable');
      const started = Date.now();
      while (await markCount(cdp, name) < 20) {
        if (Date.now() - started > 60_000) throw new Error(`${name} did not mark the text.`);
        await sleep(50);
      }
    }
    await page.locator('#away').click();
  }
  await sleep(4000);
  const totals = total(browserProcesses());
  await context.close();
  return totals;
}

/** Time and CPU per check through the extension's own message, as a page sends it. */
async function measureChecks(name) {
  const { context, id } = await launchBrowser(name);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  const extension = EXTENSIONS[name];
  const check = async () => {
    const { ms, answer } = await page.evaluate(async (message) => {
      const started = performance.now();
      const reply = await chrome.runtime.sendMessage(message);
      return { ms: performance.now() - started, answer: reply };
    }, extension.message(freshText()));
    extension.issues(answer);
    return ms;
  };
  for (let run = 0; run < WARM_UP; run += 1) await check();
  await sleep(SETTLE_MS);
  const before = total(browserProcesses());
  const times = [];
  for (let run = 0; run < RUNS; run += 1) times.push(await check());
  const after = total(browserProcesses());
  await context.close();
  return { checkMs: median(times), checkCpuMs: ((after.cpu - before.cpu) * 1000) / RUNS };
}

async function measureLanguageTool() {
  const server = spawn('java', ['-cp', 'languagetool-server.jar', 'org.languagetool.server.HTTPServer', '--port', String(LT_PORT)], {
    cwd: languageToolDir, stdio: 'ignore', windowsHide: true,
  });
  const ownProcess = () => processes((command) => command.includes('org.languagetool.server.HTTPServer') && command.includes(String(LT_PORT)))
    .sort((a, b) => b.bytes - a.bytes).slice(0, 1); // On Windows, java.exe can be a small launcher for the real one.
  const check = async () => {
    const response = await fetch(`http://127.0.0.1:${LT_PORT}/v2/check`, { method: 'POST', body: new URLSearchParams({ language: 'en-US', text: freshText() }) });
    if (!response.ok) throw new Error(`LanguageTool answered ${response.status}.`);
    return (await response.json()).matches.length;
  };
  try {
    for (let tries = 0; ; tries += 1) {
      try { await check(); break; } catch (error) { if (tries > 600) throw error; await sleep(200); }
    }
    const started = total(ownProcess());
    for (let run = 1; run < WARM_UP; run += 1) await check();
    await sleep(SETTLE_MS);
    const before = total(ownProcess());
    const times = [];
    for (let run = 0; run < RUNS; run += 1) {
      const begin = performance.now();
      await check();
      times.push(performance.now() - begin);
    }
    const after = total(ownProcess());
    return { memoryMb: after.mb, startCpu: started.cpu, checkMs: median(times), checkCpuMs: ((after.cpu - before.cpu) * 1000) / RUNS };
  } finally {
    for (const row of ownProcess()) try { process.kill(row.pid); } catch { /* already gone */ }
    server.kill();
  }
}

/**
 * Each extension's memory and start-up CPU are what it adds to the same browser run with no extension: the
 * memory after its tabs are checked, and the CPU of the whole one-tab run, up to and including the first check.
 */
async function measure() {
  const base = { one: await tabsRun(null, 1), many: await tabsRun(null, MANY_TABS) };
  const extensions = {};
  for (const name of Object.keys(EXTENSIONS)) {
    const one = await tabsRun(name, 1);
    const many = await tabsRun(name, MANY_TABS);
    extensions[name] = {
      oneTabMb: one.mb - base.one.mb, manyTabsMb: many.mb - base.many.mb, manyTabs: MANY_TABS, startCpu: one.cpu - base.one.cpu,
      ...(await measureChecks(name)), diskMb: folderMb(EXTENSIONS[name].dir),
    };
  }
  if (extensions.harper) {
    extensions.harper.version = JSON.parse(readFileSync(join(EXTENSIONS.harper.dir, 'manifest.json'), 'utf8')).version;
  }
  const languageTool = await measureLanguageTool();
  return {
    measuredAt: new Date().toISOString(),
    machine: { platform: process.platform, cpus: os.cpus().length },
    words: WORDS,
    ...extensions,
    // The version, for the website, from the folder the download unpacks to (LanguageTool-<version>).
    languageTool: { version: /LanguageTool-([\d.]+)/u.exec(languageToolDir)?.[1] ?? null, ...languageTool, diskMb: folderMb(languageToolDir) },
  };
}
const report = redrawOnly ? JSON.parse(readFileSync(languageToolArg, 'utf8')) : await measure();
if (!redrawOnly) {
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

// The chart: one group of bars per measure, each scaled to its own largest value, with how many times smaller or
// faster Wordwarden is than LanguageTool. Shorter is better. The memory and CPU rows come first; the check time last.
const ww = report.wordwarden;
const hp = report.harper ?? null;
const lt = report.languageTool;
const rows = [
  ['Memory while checking, 1 tab', ww.oneTabMb, hp?.oneTabMb, lt.memoryMb, 'MB', 'less'],
  [`Memory while checking, ${ww.manyTabs} tabs`, ww.manyTabsMb, hp?.manyTabsMb, lt.memoryMb, 'MB', 'less'],
  ['CPU time to start', ww.startCpu, hp?.startCpu, lt.startCpu, 's', 'less'],
  ['CPU time per check', ww.checkCpuMs, hp?.checkCpuMs, lt.checkCpuMs, 'ms', 'less'],
  ['Size on disk', ww.diskMb, hp?.diskMb, lt.diskMb, 'MB', 'smaller', ' + Java'],
  [`Time to check ${report.words} words`, ww.checkMs, hp?.checkMs, lt.checkMs, 'ms', 'faster'],
];
const BLUE = '#1e6fd9';
const TEAL = '#2a9d8f';
const GREY = '#9a9893';
const INK = '#1d1d1b';
const MUTED = '#6b6a66';
const RULE = '#e4e2dc';
const left = 272;
const right = 650;
const barHeight = 16;
const number = (value) => value.toLocaleString('en-GB', { maximumFractionDigits: value < 10 ? 1 : 0 });
const parts = [];
let y = 104;
for (const [title, wwValue, hpValue, ltValue, unit, better, ltNote = ''] of rows) {
  const bars = [[wwValue, BLUE, ''], ...(hp === null ? [] : [[hpValue, TEAL, '']]), [ltValue, GREY, ltNote]];
  const largest = Math.max(...bars.map(([value]) => value));
  const ratio = ltValue / wwValue;
  bars[0][2] = ratio >= 1.05 ? ` <tspan font-weight="400" fill="${MUTED}">${number(ratio)}× ${better} than LanguageTool</tspan>` : '';
  parts.push(`<text x="${left - 14}" y="${y + barHeight + 6}" font-size="14" font-weight="600" fill="${INK}" text-anchor="end">${title}</text>`);
  bars.forEach(([value, color, note], index) => {
    const top = y + index * (barHeight + 4);
    const width = Math.max(3, (value / largest) * (right - left));
    parts.push(`<rect x="${left}" y="${top}" width="${width.toFixed(1)}" height="${barHeight}" rx="2" fill="${color}"/>`);
    parts.push(`<text x="${(left + width + 6).toFixed(1)}" y="${top + 12.5}" font-size="12" font-weight="600" fill="${INK}">${number(value)} ${unit}${note}</text>`);
  });
  y += bars.length * (barHeight + 4) + 30;
}
const machine = report.machine.platform === 'linux' ? `GitHub's Linux machine (${report.machine.cpus} cores)` : `a ${{ win32: 'Windows', darwin: 'Mac' }[report.machine.platform] ?? report.machine.platform} PC (${report.machine.cpus} threads)`;
const legend = [['Wordwarden', BLUE], ...(hp === null ? [] : [[`Harper ${hp.version ?? ''} extension`.replace('  ', ' '), TEAL]]), [`LanguageTool ${lt.version ?? ''} server`.replace('  ', ' '), GREY]];
const legendHeight = legend.length * 20;
const footer = y + legendHeight + 28;
const height = footer + 66;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" viewBox="0 0 800 ${height}" font-family="Segoe UI, system-ui, -apple-system, sans-serif" role="img" aria-label="Resource use chart">
<rect width="100%" height="100%" rx="8" fill="#fbfaf7"/>
<text x="24" y="38" font-size="20" font-weight="700" fill="${INK}">Resource use</text>
<text x="24" y="60" font-size="13" fill="${MUTED}">The newest Wordwarden release against ${hp === null ? '' : 'the newest Harper extension and '}the newest LanguageTool server, on the same machine. Shorter is better.</text>
<line x1="24" y1="80" x2="776" y2="80" stroke="${RULE}"/>
${parts.join('\n')}
${legend.map(([label, color], index) => `<rect x="${left}" y="${y + 4 + index * 20}" width="12" height="12" rx="2" fill="${color}"/>
<text x="${left + 18}" y="${y + 14 + index * 20}" font-size="12.5" fill="${INK}">${label}</text>`).join('\n')}
<line x1="24" y1="${footer}" x2="776" y2="${footer}" stroke="${RULE}"/>
<text x="24" y="${footer + 22}" font-size="12" fill="${MUTED}">Measured on ${machine}. Memory is private memory: for an extension, what it adds to the browser. CPU time is summed</text>
<text x="24" y="${footer + 38}" font-size="12" fill="${MUTED}">over all cores. Check times are the median of ${RUNS} checks of new text. LanguageTool's own browser extension is not counted.</text>
<text x="24" y="${footer + 54}" font-size="12" fill="${MUTED}">Generated automatically for every release except small bug fixes.</text>
</svg>
`;
writeFileSync(outArg ?? 'docs/resources.svg', svg);
