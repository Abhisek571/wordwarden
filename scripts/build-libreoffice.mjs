// Packs the LibreOffice add-on (.oxt): the browser extension's checking engine, bundled into one script,
// run by an official Node program for each system.
// Usage: node scripts/build-libreoffice.mjs <folder with Node programs> <windows|linux|macos>...
// The folder holds windows-x86_64/node.exe, linux-x86_64/node, macos-x86_64/node, macos-aarch64/node and
// Node's LICENSE.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { build } from 'vite';

const TARGETS = {
  windows: { platform: 'windows_x86_64', builds: ['windows-x86_64'] },
  linux: { platform: 'linux_x86_64', builds: ['linux-x86_64'] },
  macos: { platform: 'macosx_x86_64,macosx_aarch64', builds: ['macos-x86_64', 'macos-aarch64'] },
};
// The same data files the browser extension ships (see wxt.config.ts).
const ENGINE_DATA = {
  'harper_wasm_bg.wasm': 'node_modules/harper.js/dist/harper_wasm_bg.wasm',
  'spelling/en.aff': 'node_modules/dictionary-en/index.aff',
  'spelling/en.dic': 'node_modules/dictionary-en/index.dic',
  'spelling/en-au.aff': 'node_modules/dictionary-en-au/index.aff',
  'spelling/en-au.dic': 'node_modules/dictionary-en-au/index.dic',
  'spelling/en-ca.aff': 'node_modules/dictionary-en-ca/index.aff',
  'spelling/en-ca.dic': 'node_modules/dictionary-en-ca/index.dic',
  'spelling/en-gb.aff': 'node_modules/dictionary-en-gb/index.aff',
  'spelling/en-gb.dic': 'node_modules/dictionary-en-gb/index.dic',
  'spelling/frequencies.json': 'node_modules/subtlex-word-frequencies/index.json',
};

const [nodeDir, ...targets] = process.argv.slice(2);
if (nodeDir === undefined || targets.length === 0 || targets.some((target) => !(target in TARGETS))) {
  console.error('Usage: node scripts/build-libreoffice.mjs <folder with Node programs> <windows|linux|macos>...');
  process.exit(1);
}
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

const engineDir = '.output/libreoffice-engine';
await build({
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  resolve: { alias: { '#': fileURLToPath(new URL('../src', import.meta.url)) } },
  ssr: { noExternal: true },
  build: {
    ssr: 'src/standalone/engine-host.ts',
    outDir: engineDir,
    emptyOutDir: true,
    target: 'node22',
    minify: true,
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'engine-host.cjs', inlineDynamicImports: true } },
  },
});
const engineScript = readFileSync(join(engineDir, 'engine-host.cjs'));

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function pack(target) {
  const { platform, builds } = TARGETS[target];
  /** Entries as [path inside the add-on, contents, executable]. */
  const entries = [];
  for (const file of filesUnder('libreoffice')) {
    const name = relative('libreoffice', file).split(sep).join('/');
    if (name.endsWith('.pyc') || name.includes('__pycache__')) continue;
    let contents = readFileSync(file);
    if (name === 'description.xml') {
      contents = Buffer.from(contents.toString('utf8').replace('@VERSION@', version).replace('@PLATFORM@', platform));
    }
    entries.push([name, contents, false]);
  }
  entries.push(['icon.png', readFileSync('public/icon-128.png'), false]);
  entries.push(['LICENSE', readFileSync('LICENSE'), false]);
  entries.push(['THIRD_PARTY_NOTICES.md', readFileSync('THIRD_PARTY_NOTICES.md'), false]);
  entries.push(['licenses/Node.js-LICENSE.txt', readFileSync(join(nodeDir, 'LICENSE')), false]);
  entries.push(['licenses/SUBTLEX-frequencies-ISC.txt', readFileSync('node_modules/subtlex-word-frequencies/license'), false]);
  entries.push(['engine/engine-host.cjs', engineScript, false]);
  for (const [name, source] of Object.entries(ENGINE_DATA)) entries.push([`engine/data/${name}`, readFileSync(source), false]);
  for (const build of builds) {
    const exe = build.startsWith('windows') ? 'node.exe' : 'node';
    entries.push([`bin/${build}/${exe}`, readFileSync(join(nodeDir, build, exe)), true]);
  }

  // A plain zip writer: deflate, CRC-32, and Unix permissions so Node stays executable where that is kept.
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, contents, executable] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(contents, { level: 9 });
    const checksum = crc32(contents);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(0x00210000, 10); // 1980-01-01, so every build of the same files is identical
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(contents.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(0x0314, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(0x00210000, 12);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(contents.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(((executable ? 0o100755 : 0o100644) << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += header.length + nameBytes.length + packed.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  const output = `.output/wordwarden-${version}-libreoffice-${target}.oxt`;
  writeFileSync(output, Buffer.concat([...local, ...central, end]));
  console.log(`${output} (${(statSync(output).size / 1024 / 1024).toFixed(1)} MB)`);
}

mkdirSync('.output', { recursive: true });
for (const target of targets) pack(target);
