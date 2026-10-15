import { defineConfig } from 'wxt';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Wordwarden core, built from the Rust sources in core/ by scripts/build-core.mjs (see core/README.md).
const wordwardenCoreWasmPath = fileURLToPath(new URL('./core/dist/wordwarden_core_bg.wasm', import.meta.url));
const spellingRuntimeAssets = Object.freeze([
  Object.freeze({ fileName: 'spelling/en.aff', path: './node_modules/dictionary-en/index.aff' }),
  Object.freeze({ fileName: 'spelling/en.dic', path: './node_modules/dictionary-en/index.dic' }),
  Object.freeze({ fileName: 'spelling/en-au.aff', path: './node_modules/dictionary-en-au/index.aff' }),
  Object.freeze({ fileName: 'spelling/en-au.dic', path: './node_modules/dictionary-en-au/index.dic' }),
  Object.freeze({ fileName: 'spelling/en-ca.aff', path: './node_modules/dictionary-en-ca/index.aff' }),
  Object.freeze({ fileName: 'spelling/en-ca.dic', path: './node_modules/dictionary-en-ca/index.dic' }),
  Object.freeze({ fileName: 'spelling/en-gb.aff', path: './node_modules/dictionary-en-gb/index.aff' }),
  Object.freeze({ fileName: 'spelling/en-gb.dic', path: './node_modules/dictionary-en-gb/index.dic' }),
  Object.freeze({
    fileName: 'spelling/frequencies.json',
    path: './node_modules/subtlex-word-frequencies/index.json',
  }),
]);
const packageNoticeAssets = Object.freeze([
  Object.freeze({ fileName: 'THIRD_PARTY_NOTICES.txt', path: './THIRD_PARTY_NOTICES.md' }),
  Object.freeze({ fileName: 'licenses/Apache-2.0.txt', path: './core/LICENSE' }),
  Object.freeze({ fileName: 'licenses/React-MIT.txt', path: './node_modules/react/LICENSE' }),
  Object.freeze({ fileName: 'licenses/nspell-MIT.txt', path: './node_modules/nspell/license' }),
  Object.freeze({
    fileName: 'licenses/English-dictionaries-MIT-BSD.txt',
    path: './node_modules/dictionary-en/license',
  }),
  Object.freeze({
    fileName: 'licenses/SUBTLEX-frequencies-ISC.txt',
    path: './node_modules/subtlex-word-frequencies/license',
  }),
]);

// The sources zip has no .gitignore, and reviewers build from that zip.
const gitIgnorePath = new URL('./.gitignore', import.meta.url);
const gitIgnoredPatterns = (existsSync(gitIgnorePath) ? readFileSync(gitIgnorePath, 'utf8') : '')
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'))
  .map((line) => (line.endsWith('/') ? `${line}**` : line));

export default defineConfig({
  srcDir: '.',
  // The Firefox sources zip is built from the working folder, so leave out everything git ignores too.
  zip: { excludeSources: gitIgnoredPatterns },
  manifest: ({ browser }) => ({
    name: 'Wordwarden – English Spelling & Grammar Check',
    short_name: 'Wordwarden',
    description: 'Private, on-device spelling and grammar.',
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    permissions: ['storage', 'activeTab'],
    host_permissions: ['<all_urls>'],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'",
    },
    browser_specific_settings:
      browser === 'firefox'
        ? {
            gecko: {
              id: 'wordwarden@local-writing-assistant',
              strict_min_version: '142.0',
              data_collection_permissions: {
                required: ['none'],
              },
            },
          }
        : undefined,
  }),
  vite: () => ({
    plugins: [
      {
        name: 'typecheck-wordwarden-core-wasm',
        apply: 'build',
        buildStart() {
          this.emitFile({
            type: 'asset',
            fileName: 'wordwarden_core_bg.wasm',
            source: readFileSync(wordwardenCoreWasmPath),
          });
          for (const asset of spellingRuntimeAssets) {
            const assetPath = fileURLToPath(new URL(asset.path, import.meta.url));
            this.emitFile({
              type: 'asset',
              fileName: asset.fileName,
              source: readFileSync(assetPath),
            });
          }
          for (const notice of packageNoticeAssets) {
            const noticePath = fileURLToPath(new URL(notice.path, import.meta.url));
            this.emitFile({
              type: 'asset',
              fileName: notice.fileName,
              source: readFileSync(noticePath),
            });
          }
        },
      },
    ],
    resolve: {
      alias: {
        '#': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      target: 'es2022',
      assetsInlineLimit: 0,
    },
  }),
});
