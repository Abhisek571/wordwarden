import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  [
    'node_modules/web-ext/bin/web-ext.js',
    'lint',
    '--source-dir',
    '.output/firefox-mv3',
    '--output',
    'json',
    '--no-input',
  ],
  { encoding: 'utf8' },
);

if (result.error) throw result.error;

const report = JSON.parse(result.stdout);
if (typeof report !== 'object' || report === null) {
  throw new TypeError('Firefox lint returned an invalid report.');
}

const errors = Array.isArray(report.errors) ? report.errors : null;
const warnings = Array.isArray(report.warnings) ? report.warnings : null;
if (errors === null || warnings === null) {
  throw new TypeError('Firefox lint report is missing errors or warnings.');
}

function isReviewedWarning(warning) {
  if (typeof warning !== 'object' || warning === null) return false;
  const code = String(warning.code);
  const file = String(warning.file);
  if (code === 'MANIFEST_CSP' && file === 'manifest.json') return true;
  if (code === 'DANGEROUS_EVAL' && /^ort-wasm-simd-threaded\.(asyncify|jsep)\.mjs$/.test(file)) {
    return true;
  }
  if (code !== 'UNSAFE_VAR_ASSIGNMENT') return false;
  // React DOM's own innerHTML handling; the bundler names its chunk after the first page that imports it.
  return /^chunks\/(jsx-runtime|app)-[\w-]+\.js$/.test(file) ||
    /^assets\/completion\.worker-[\w-]+\.js$/.test(file);
}

const unexpectedWarnings = warnings.filter((warning) => !isReviewedWarning(warning));
if (result.status !== 0 || errors.length > 0 || unexpectedWarnings.length > 0) {
  process.stderr.write(`${JSON.stringify({ errors, unexpectedWarnings }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Firefox lint passed: 0 errors, 0 unexpected warnings, ${warnings.length} reviewed dependency warnings.\n`,
  );
}
