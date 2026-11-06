const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { performance } = require('perf_hooks');
const { execFileSync } = require('child_process');
const { isDeepStrictEqual } = require('util');
const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.cache', 'estimation-benchmark');
const cases = { small:[1,[20,20,20]], dense:[100,[120,120,120]], tall:[100,[30,30,180]], large:[180,[120,120,120]] };

require.extensions['.ts'] = function(mod, filename) {
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
};

const { makeBoxFixture } = require('../tests/helpers/meshFixtures.ts');

if (process.argv[2] === '--estimate-file') {
  console.log(JSON.stringify(require(path.join(root, 'src/lib/estimation.ts')).estimateFromFile(process.argv[3], 'PLA')));
} else if (process.argv[2] === '--worker') {
  const variant = process.argv[3];
  const fixture = process.argv[4];
  const filename = path.join(cache, `${fixture}.stl`);
  const estimator = require(variant === 'baseline' ? path.join(cache, 'baseline.ts') : path.join(root, 'src/lib/estimation.ts'));
  const durations = [];
  let result;
  for (let repeat=0;repeat<3;repeat++) {
    if(global.gc) global.gc();
    const start=performance.now();
    result = estimator.estimateFromFile(filename,'PLA');
    durations.push(Math.round(performance.now()-start));
  }
  console.log(JSON.stringify({variant,fixture,bytes:fs.statSync(filename).size,durations,medianMs:[...durations].sort((a,b)=>a-b)[1],result,rssMB:Math.round(process.memoryUsage().rss/1024/1024)}));
} else {
  // Usage: node scripts/benchmark-estimation.cjs --baseline=6ef4919
  // Synthetic files only. No environment files, customer uploads, database or network are used.
  const baselineRef = process.argv.find((arg) => arg.startsWith('--baseline='))?.slice('--baseline='.length);
  fs.mkdirSync(cache, { recursive: true });
  if (baselineRef) {
    const source = execFileSync('git', ['show', `${baselineRef}:src/lib/estimation.ts`], { cwd: root, encoding: 'utf8' });
    fs.writeFileSync(path.join(cache, 'baseline.ts'), source);
  }
  const defaults = {
    FILL_FACTOR:'0.25', MIN_GRAMS_PER_FILE:'5', QUOTE_LAYER_HEIGHT_MM:'0.2', QUOTE_LINE_WIDTH_MM:'0.45',
    QUOTE_WALL_COUNT:'2', QUOTE_TOP_BOTTOM_LAYERS:'5', QUOTE_INFILL_DENSITY:'0.15', QUOTE_TARGET_TOTAL_CELLS:'12000000',
    QUOTE_SHELL_FACTOR:'0.9', QUOTE_SOLID_FACTOR:'0.88', QUOTE_LARGE_PART_RESOLUTION_FACTOR:'0.85',
    QUOTE_MAX_LAYER_COUNT:'2500', QUOTE_MAX_LAYER_CELLS:'1000000', QUOTE_MAX_TRIANGLES:'300000',
  };
  const report = [];
  for (const [fixture, parameters] of Object.entries(cases)) {
    fs.writeFileSync(path.join(cache, `${fixture}.stl`), makeBoxFixture(...parameters));
    const measure = (variant) => JSON.parse(execFileSync(process.execPath, ['--expose-gc', __filename, '--worker', variant, fixture], {
      cwd: root, env: { ...process.env, ...defaults }, encoding: 'utf8', timeout: 120000,
    }));
    const baseline = baselineRef ? measure('baseline') : undefined;
    const current = measure('current');
    const equal = baseline ? isDeepStrictEqual(baseline.result, current.result) : undefined;
    report.push({ fixture, baseline, current, equal });
    if (equal === false) process.exitCode = 1;
  }
  fs.writeFileSync(path.join(cache, 'report.json'), JSON.stringify({ baselineRef, report }, null, 2));
  console.table(report.map(({ fixture, baseline, current, equal }) => ({
    fixture, baselineMs: baseline?.medianMs ?? '-', currentMs: current.medianMs,
    improvement: baseline ? `${Math.round((1-current.medianMs/baseline.medianMs)*100)}%` : '-',
    baselineRssMB: baseline?.rssMB ?? '-', currentRssMB: current.rssMB, identicalResult: equal ?? '-',
  })));
  console.log(`Detailed report: ${path.join(cache, 'report.json')}`);
}
