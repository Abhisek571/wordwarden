import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type CDPSession,
  type Page,
} from '@playwright/test';
import { resolve } from 'node:path';

let context: BrowserContext | null = null;

type ShadowNode = Readonly<{ nodeId: number; attributes?: string[] }>;

function attributes(node: ShadowNode): Readonly<Record<string, string>> {
  const values = node.attributes ?? [];
  return Object.freeze(
    Object.fromEntries(
      Array.from({ length: values.length / 2 }, (_, index) => [
        values[index * 2] ?? '',
        values[index * 2 + 1] ?? '',
      ]),
    ),
  );
}

async function shadowNodes(cdp: CDPSession, testId: string): Promise<readonly ShadowNode[]> {
  const result = await cdp.send('DOM.getFlattenedDocument', { depth: -1, pierce: true });
  return result.nodes.filter((node) => attributes(node)['data-testid'] === testId);
}

async function clickShadowNode(
  page: Page,
  cdp: CDPSession,
  node: ShadowNode,
): Promise<void> {
  const box = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId });
  const quad = box.model.border;
  await page.mouse.click(
    ((quad[0] ?? 0) + (quad[2] ?? 0) + (quad[4] ?? 0) + (quad[6] ?? 0)) / 4,
    ((quad[1] ?? 0) + (quad[3] ?? 0) + (quad[5] ?? 0) + (quad[7] ?? 0)) / 4,
  );
}

function loadedExtensionId(): string {
  const worker = context?.serviceWorkers()[0];
  if (worker === undefined) throw new Error('Extension service worker is unavailable.');
  return new URL(worker.url()).hostname;
}

test.beforeAll(async () => {
  const extensionPath = resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  if (context.serviceWorkers().length === 0) {
    await context.waitForEvent('serviceworker', { timeout: 10_000 });
  }
});

test.afterAll(async () => {
  await context?.close();
});

test('loads without touching sensitive fields', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const page = await context.newPage();
  const browserMessages: string[] = [];
  page.on('console', (message) => browserMessages.push(message.text()));
  page.on('pageerror', (error) => browserMessages.push(error.message));
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#editor').focus();
  await expect(page.locator('#private')).toHaveValue('secret');
  await expect(
    page.locator('#typecheck-root'),
    `Browser messages: ${browserMessages.join(' | ')}`,
  ).toHaveCount(1);
});

test('checks a field that already had focus when the extension started', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await page.goto('http://127.0.0.1:4173/?autofocus');
  await expect
    .poll(async () => (await shadowNodes(cdp, 'issue-mark')).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await page.close();
});

test('surfaces individual grammar issues in the reported sentence', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const extensionId = loadedExtensionId();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await page.goto(`chrome-extension://${extensionId}/playground.html`);
  await page.locator('#editor').fill(
    'Me and my friend was going to the shops yesterday but we doesnt know where it is so we was walking around for nearly two hour and then someone tell us that the shop have already closed before we got there.',
  );

  await expect
    .poll(async () => (await shadowNodes(cdp, 'issue-mark')).length, { timeout: 10_000 })
    .toBe(7);
  const marks = await shadowNodes(cdp, 'issue-mark');
  expect(marks.filter((node) => attributes(node).class === 'mark grammar')).toHaveLength(6);
  expect(marks.filter((node) => attributes(node).class === 'mark spelling')).toHaveLength(1);
  await page.close();
});

test('keeps unresolved issue markers active after applying one correction', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const extensionId = loadedExtensionId();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await page.goto(`chrome-extension://${extensionId}/playground.html`);
  const editor = page.locator('#editor');
  await editor.fill('wrods and teh');

  await expect
    .poll(async () => (await shadowNodes(cdp, 'issue-mark')).length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
  const issueMarks = await shadowNodes(cdp, 'issue-mark');
  const firstIssue = issueMarks.find((node) => attributes(node)['aria-label']?.includes('wrods'));
  if (firstIssue === undefined) throw new Error('Expected a spelling marker for “wrods”.');
  await clickShadowNode(page, cdp, firstIssue);

  await expect
    .poll(async () => (await shadowNodes(cdp, 'apply-suggestion')).length)
    .toBeGreaterThan(0);
  const [replacement] = await shadowNodes(cdp, 'apply-suggestion');
  if (replacement === undefined) throw new Error('Expected a replacement button.');
  await clickShadowNode(page, cdp, replacement);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));

  expect((await shadowNodes(cdp, 'issue-mark')).length).toBeGreaterThanOrEqual(1);
  await expect(editor).not.toHaveValue(/wrods/u);
  await expect(editor).toHaveValue(/teh/u);
  await page.close();
});

test('preserves native undo and redo for a website textarea correction', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await page.goto('http://127.0.0.1:4173');
  const editor = page.locator('#editor');
  await editor.fill('wrods and text');
  await expect.poll(async () => (await shadowNodes(cdp, 'issue-mark'))
    .some((node) => attributes(node)['aria-label']?.includes('wrods')), { timeout: 10_000 }).toBe(true);
  const mark = (await shadowNodes(cdp, 'issue-mark'))
    .find((node) => attributes(node)['aria-label']?.includes('wrods'));
  if (!mark) throw new Error('Missing word marker.');
  await clickShadowNode(page, cdp, mark);
  await expect.poll(async () => (await shadowNodes(cdp, 'apply-suggestion')).length).toBeGreaterThan(0);
  const [button] = await shadowNodes(cdp, 'apply-suggestion');
  if (!button) throw new Error('Missing replacement.');
  await clickShadowNode(page, cdp, button);
  await expect(editor).not.toHaveValue('wrods and text');
  const corrected = await editor.inputValue();
  await editor.press('Control+z');
  await expect(editor).toHaveValue('wrods and text');
  await editor.press('Control+Shift+z');
  await expect(editor).toHaveValue(corrected);
  await page.close();
});

test('corrects the right word in a multi-paragraph contenteditable with undo and redo', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await page.goto('http://127.0.0.1:4173');
  const editor = page.locator('#rich-blocks');
  await editor.locator('div').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  await expect.poll(async () => (await shadowNodes(cdp, 'issue-mark'))
    .some((node) => attributes(node)['aria-label']?.includes('wrods')), { timeout: 10_000 }).toBe(true);
  const mark = (await shadowNodes(cdp, 'issue-mark'))
    .find((node) => attributes(node)['aria-label']?.includes('wrods'));
  if (!mark) throw new Error('Missing word marker.');
  await clickShadowNode(page, cdp, mark);
  await expect.poll(async () => (await shadowNodes(cdp, 'apply-suggestion')).length).toBeGreaterThan(0);
  const [button] = await shadowNodes(cdp, 'apply-suggestion');
  if (!button) throw new Error('Missing replacement.');
  await clickShadowNode(page, cdp, button);
  await expect(editor).not.toContainText('wrods');
  await expect(editor.locator('div').nth(1)).toHaveText(/^Second [a-z]+ here\.$/u);
  await expect(editor.locator('div').first()).toContainText('First line here.');
  const corrected = await editor.innerHTML();
  await page.keyboard.press('Control+z');
  await expect(editor).toContainText('wrods');
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => editor.innerHTML()).toBe(corrected);
  await page.close();
});

test('replaces the word, not the cursor position, in an editor that tracks its own selection', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await page.goto('http://127.0.0.1:4173');
  const editor = page.locator('#lagging');
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  const findMark = async () => (await shadowNodes(cdp, 'issue-mark'))
    .find((node) => /does not start with a capital/iu.test(attributes(node)['aria-label'] ?? ''));
  await expect.poll(async () => (await findMark()) !== undefined, { timeout: 10_000 }).toBe(true);
  const mark = await findMark();
  if (!mark) throw new Error('Missing marker for "which".');
  await clickShadowNode(page, cdp, mark);
  await expect.poll(async () => (await shadowNodes(cdp, 'apply-suggestion')).length).toBeGreaterThan(0);
  const [button] = await shadowNodes(cdp, 'apply-suggestion');
  if (!button) throw new Error('Missing replacement.');
  await clickShadowNode(page, cdp, button);
  await expect(editor).toHaveText(/^Some cloud features\. Which i find annoying\.\s?$/u);
  await page.close();
});

test('replaces the word in an editor that restores its cursor when it gets focus back', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await page.goto('http://127.0.0.1:4173');
  const editor = page.locator('#restoring');
  await editor.click();
  await page.keyboard.press('End');
  const findMark = async () => (await shadowNodes(cdp, 'issue-mark'))
    .find((node) => attributes(node)['aria-label']?.includes('sda'));
  await expect.poll(async () => (await findMark()) !== undefined, { timeout: 10_000 }).toBe(true);
  const [button] = await (async () => {
    const mark = await findMark();
    if (!mark) throw new Error('Missing marker for "sda".');
    await clickShadowNode(page, cdp, mark);
    await expect.poll(async () => (await shadowNodes(cdp, 'apply-suggestion')).length).toBeGreaterThan(0);
    return shadowNodes(cdp, 'apply-suggestion');
  })();
  if (!button) throw new Error('Missing replacement.');
  // Clicking the card takes focus from the field, as it does on Twitch.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await clickShadowNode(page, cdp, button);
  // The suggestions for "sda" are three or four letters; a fix put in the wrong place leaves more.
  await expect(editor).toHaveText(/^Say hi (?!sda$)[a-z]{3,4}$/u);
  await page.close();
});

test('reports success in an editor that draws the fix a moment later', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await page.goto('http://127.0.0.1:4173');
  const editor = page.locator('#delayed');
  await editor.click();
  await page.keyboard.press('End');
  const findMark = async () => (await shadowNodes(cdp, 'issue-mark'))
    .find((node) => attributes(node)['aria-label']?.includes('sda'));
  await expect.poll(async () => (await findMark()) !== undefined, { timeout: 10_000 }).toBe(true);
  const mark = await findMark();
  if (!mark) throw new Error('Missing marker for "sda".');
  await clickShadowNode(page, cdp, mark);
  await expect.poll(async () => (await shadowNodes(cdp, 'apply-suggestion')).length).toBeGreaterThan(0);
  const [button] = await shadowNodes(cdp, 'apply-suggestion');
  if (!button) throw new Error('Missing replacement.');
  await clickShadowNode(page, cdp, button);
  await expect(editor).toHaveText(/^Say hi (?!sda$)[a-z]{3,4}$/u);
  await page.waitForTimeout(300);
  expect(await shadowNodes(cdp, 'status')).toHaveLength(0);
  await page.close();
});

test('shows an issue count badge in the field and a tick once the text is clean', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await page.goto('http://127.0.0.1:4173');
  const editor = page.locator('#editor');
  const badgeState = async (): Promise<string | undefined> => {
    const [badge] = await shadowNodes(cdp, 'status-badge');
    return badge === undefined ? undefined : attributes(badge)['data-state'];
  };
  await editor.fill('Thanks for teh update.');
  await expect.poll(badgeState, { timeout: 10_000 }).toBe('issues');
  const [badge] = await shadowNodes(cdp, 'status-badge');
  expect(attributes(badge!)['aria-label']).toBe('Wordwarden: 1 suggestion');
  await clickShadowNode(page, cdp, badge!);
  await expect.poll(async () => (await shadowNodes(cdp, 'issue-popover')).length).toBe(1);
  await expect(editor).toBeFocused();
  await editor.fill('Thanks for the update.');
  await expect.poll(badgeState, { timeout: 10_000 }).toBe('clear');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await expect.poll(badgeState).toBeUndefined();
  await page.close();
});

test('opens Settings as a full tab and previews diagnostics before sharing', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const extensionId = loadedExtensionId();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  const [settingsPage] = await Promise.all([
    context.waitForEvent('page'),
    popup.getByRole('button', { name: 'Report issue' }).click(),
  ]);
  await settingsPage.waitForLoadState();
  await expect(settingsPage.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const manifest = await settingsPage.evaluate(async () =>
    (await fetch('/manifest.json')).json() as Promise<{
      manifest_version: number;
      options_ui: { open_in_tab: boolean };
    }>,
  );
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.options_ui.open_in_tab).toBe(true);

  await expect(settingsPage.getByTestId('issue-report')).toBeVisible();
  await expect(settingsPage.getByTestId('issue-report')).toHaveAttribute('role', 'dialog');
  await expect(settingsPage.locator('#report-heading')).toBeFocused();
  await expect(settingsPage.locator('#diagnostic-report')).toHaveCount(0);
  await expect(settingsPage.getByTestId('issue-report').getByRole('textbox')).toHaveCount(0);
  await settingsPage.getByRole('button', { name: 'Generate diagnostic log' }).click();

  const preview = settingsPage.locator('#diagnostic-report');
  await expect(preview).toBeVisible();
  const report = JSON.parse(await preview.inputValue()) as {
    schemaVersion: number;
    wordwarden: string;
    checker: { webAssembly: boolean };
    recentErrors: unknown[];
  };
  expect(report.schemaVersion).toBe(2);
  expect(report.wordwarden).toMatch(/^\d+\.\d+\.\d+$/u);
  expect(report.checker.webAssembly).toBe(true);
  expect(Array.isArray(report.recentErrors)).toBe(true);
  expect(report).toHaveProperty('site');
  await settingsPage.getByRole('button', { name: 'Copy log' }).click();
  await expect(settingsPage.getByText('Report copied to the clipboard.')).toBeVisible();
  await expect(settingsPage.getByRole('button', { name: 'Open GitHub Issue' })).toBeEnabled();
  await expect(settingsPage.getByText('Nothing is sent automatically.')).toBeVisible();
  await settingsPage.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(settingsPage.getByTestId('issue-report')).toHaveCount(0);
  const opener = settingsPage.getByRole('button', { name: 'Report issue', exact: true }).first();
  await opener.click();
  await expect(settingsPage.locator('#report-heading')).toBeFocused();
  await settingsPage.keyboard.press('Shift+Tab');
  await expect(settingsPage.getByRole('button', { name: 'Generate diagnostic log' })).toBeFocused();
  await settingsPage.keyboard.press('Tab');
  await expect(settingsPage.getByRole('button', { name: 'Close diagnostic report' })).toBeFocused();
  await settingsPage.keyboard.press('Escape');
  await expect(settingsPage.getByTestId('issue-report')).toHaveCount(0);
  await expect(opener).toBeFocused();
  await settingsPage.close();
});

test('does not annotate tokenized payment or OTP fields', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await page.goto('http://127.0.0.1:4173');
  await page.evaluate(() => {
    const payment = document.createElement('input');
    payment.id = 'payment';
    payment.autocomplete = 'section-checkout billing cc-number';
    const otp = document.createElement('textarea');
    otp.id = 'otp';
    otp.autocomplete = 'one-time-code';
    document.body.append(payment, otp);
  });
  for (const id of ['payment', 'otp']) {
    await page.locator(`#${id}`).fill('wrods and teh');
    await page.waitForTimeout(800); // Longer than the checker debounce; absence must persist.
    expect(await shadowNodes(cdp, 'issue-mark')).toHaveLength(0);
    await expect(page.locator(`#${id}`)).toHaveValue('wrods and teh');
  }
  await page.close();
});

test('persists the dialect, searches the dictionary, and imports and exports settings', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${loadedExtensionId()}/options.html`);
  await popup.getByTestId('dialect').selectOption('australian');
  await expect(popup.getByTestId('dialect')).toBeEnabled();
  const options = await context.newPage();
  await options.goto(`chrome-extension://${loadedExtensionId()}/options.html`);
  await expect(options.getByTestId('dialect')).toHaveValue('australian');
  await options.getByTestId('dictionary-word').fill('TypeCheckTestWord');
  await options.getByRole('button', { name: 'Add word', exact: true }).click();
  await expect(options.getByTestId('dictionary-word')).toHaveValue('');
  await options.getByTestId('settings-import').setInputFiles({
    name: 'words.txt', mimeType: 'text/plain', buffer: Buffer.from('TypeCheckTestWord\nImportedTestWord\n'),
  });
  await expect(options.getByText('Merge 1 new word with the current dictionary?')).toBeVisible();
  await options.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await expect(options.getByRole('button', { name: 'Remove ImportedTestWord', exact: true })).toBeVisible();
  await options.getByRole('searchbox', { name: 'Search dictionary' }).fill('Imported');
  await expect(options.getByRole('button', { name: 'Remove TypeCheckTestWord', exact: true })).toHaveCount(0);
  const downloadPromise = options.waitForEvent('download');
  await options.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('wordwarden-settings.json');
  const stream = await download.createReadStream();
  if (stream === null) throw new Error('Settings export was not downloaded.');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { settings: { dialect: string; dictionary: string[] } };
  expect(exported.settings.dialect).toBe('australian');
  expect(exported.settings.dictionary).toEqual(expect.arrayContaining(['TypeCheckTestWord', 'ImportedTestWord']));
  expect(exported.settings.dictionary).not.toContain('OpenAI');
  expect(exported.settings.dictionary).not.toContain('SpaceX');
  await options.getByTestId('settings-import').setInputFiles({
    name: 'wordwarden-settings.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'wordwarden-settings', version: 1, settings: { ...exported.settings, dialect: 'canadian' } })),
  });
  await expect(options.getByText('Replace your current settings with this file?', { exact: false })).toBeVisible();
  await options.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await expect(options.getByTestId('dialect')).toHaveValue('canadian');
  await options.reload();
  await expect(options.getByRole('button', { name: 'Remove ImportedTestWord', exact: true })).toBeVisible();
  await expect(options.getByTestId('dialect')).toHaveValue('canadian');
  await options.close();
  await popup.close();
});

test('applies a dialect change to an open page without reloading it', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${loadedExtensionId()}/options.html`);
  await popup.getByTestId('dialect').selectOption('american');
  await expect(popup.getByTestId('dialect')).toBeEnabled();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#editor').fill('I like the colour red and teh blue.');
  const marked = async (word: string): Promise<boolean> => (await shadowNodes(cdp, 'issue-mark'))
    .some((node) => attributes(node)['aria-label']?.includes(word));
  await expect.poll(() => marked('colour'), { timeout: 10_000 }).toBe(true);
  await popup.bringToFront();
  await popup.getByTestId('dialect').selectOption('british');
  await expect(popup.getByText('Settings saved.', { exact: true })).toBeVisible();
  // The page re-checks with the new dialect: the typo comes back, the British spelling does not.
  await expect.poll(async () => [await marked('colour'), await marked('teh')], { timeout: 10_000 })
    .toEqual([false, true]);
  await page.close();
  await popup.close();
});

test('recognizes bundled brands offline without hiding nearby typos', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${loadedExtensionId()}/options.html`);
  await popup.getByTestId('dialect').selectOption('american');
  await expect(popup.getByTestId('dialect')).toBeEnabled();
  await popup.close();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  try {
    await context.setOffline(true);
    await page.goto(`chrome-extension://${loadedExtensionId()}/playground.html`);
    await page.locator('#editor').fill('OpenAI and SpaceX use wrods. openai spacex ChatGPT chatgpt');
    await expect.poll(async () => {
      const marks = await shadowNodes(cdp, 'issue-mark');
      return marks.map((node) => attributes(node)['aria-label'] ?? '').join(' | ');
    }, { timeout: 15_000 }).toContain('wrods');
    const labels = (await shadowNodes(cdp, 'issue-mark'))
      .filter((node) => attributes(node).class === 'mark spelling')
      .map((node) => attributes(node)['aria-label'] ?? '').join(' | ');
    for (const name of ['OpenAI', 'SpaceX', 'openai', 'spacex', 'ChatGPT', 'chatgpt']) {
      expect(labels).not.toContain(name);
    }
  } finally {
    await context.setOffline(false);
    await page.close();
  }
});

test('opens the packaged typing test from the popup', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const extensionId = loadedExtensionId();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  const [playground] = await Promise.all([
    context.waitForEvent('page'),
    popup.getByRole('button', { name: 'Open typing test page' }).click(),
  ]);
  await playground.waitForLoadState();

  expect(playground.url()).toBe(`chrome-extension://${extensionId}/playground.html`);
  await expect(playground.getByRole('heading', { name: 'Try your writing here.' })).toBeVisible();
  const editor = playground.locator('#editor');
  await editor.fill('wrods and teh');
  const cdp = await context.newCDPSession(playground);
  await cdp.send('DOM.enable');
  await expect
    .poll(async () => (await shadowNodes(cdp, 'issue-mark')).length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);

  await playground.close();
});

test('checks a field inside a frame', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await page.route('http://127.0.0.1:4173/framed', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><iframe id="frame" srcdoc="<textarea id=inner style=\'width:400px;height:80px\'></textarea>"></iframe>',
  }));
  await page.goto('http://127.0.0.1:4173/framed');
  const inner = page.frameLocator('#frame').locator('#inner');
  await inner.fill('wrods and teh');
  await expect
    .poll(async () => (await shadowNodes(cdp, 'issue-mark')).length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
  await page.close();
});

test('leaves Alt+digit typed in another control alone while a card is open', async () => {
  if (context === null) throw new Error('Extension browser context did not start.');
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await page.goto('http://127.0.0.1:4173');
  await page.evaluate(() => {
    const other = document.createElement('input');
    other.id = 'other';
    document.body.append(other);
  });
  const editor = page.locator('#editor');
  await editor.fill('wrods and text');
  await expect.poll(async () => (await shadowNodes(cdp, 'issue-mark'))
    .some((node) => attributes(node)['aria-label']?.includes('wrods')), { timeout: 10_000 }).toBe(true);
  const mark = (await shadowNodes(cdp, 'issue-mark'))
    .find((node) => attributes(node)['aria-label']?.includes('wrods'));
  if (!mark) throw new Error('Missing word marker.');
  await clickShadowNode(page, cdp, mark);
  await expect.poll(async () => (await shadowNodes(cdp, 'apply-suggestion')).length).toBeGreaterThan(0);
  await page.locator('#other').focus();
  await page.keyboard.press('Alt+1');
  await page.waitForTimeout(300);
  await expect(editor).toHaveValue('wrods and text');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('other');
  await page.close();
});
