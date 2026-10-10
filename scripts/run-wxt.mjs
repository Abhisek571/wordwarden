import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [command, outputName, ...args] = process.argv.slice(2);
if (command !== 'build' && command !== 'zip') {
  throw new TypeError('Expected a WXT build or zip command.');
}
if (outputName !== 'chrome-mv3' && outputName !== 'firefox-mv3') {
  throw new TypeError('Expected a known WXT output directory.');
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = fileURLToPath(new URL(`../.output/${outputName}/`, import.meta.url));
const wxt = fileURLToPath(new URL('../node_modules/wxt/bin/wxt.mjs', import.meta.url));
rmSync(outputDirectory, { recursive: true, force: true });

const result = spawnSync(process.execPath, [wxt, command, projectRoot, ...args], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
