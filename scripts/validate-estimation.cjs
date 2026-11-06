// Extended, deterministic numerical regression check; intentionally separate from routine Jest runs.
// node scripts/validate-estimation.cjs --baseline=6ef4919 --cases=100 --seed=20261106
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const { execFileSync } = require('child_process');
const { isDeepStrictEqual } = require('util');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'estimation-validation');
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const baselineRef = option('baseline', '6ef4919');
const caseCount = Number(option('cases', '100'));
const seed = Number(option('seed', '20261106'));
if (!Number.isInteger(caseCount) || caseCount < 1 || caseCount > 1000 || !Number.isSafeInteger(seed)) throw new Error('Use --cases=1..1000 and an integer --seed.');

// Set documented defaults for both versions, without reading environment files.
Object.assign(process.env, {
  FILL_FACTOR:'0.25', MIN_GRAMS_PER_FILE:'5', QUOTE_LAYER_HEIGHT_MM:'0.2', QUOTE_LINE_WIDTH_MM:'0.45',
  QUOTE_WALL_COUNT:'2', QUOTE_TOP_BOTTOM_LAYERS:'5', QUOTE_INFILL_DENSITY:'0.15', QUOTE_TARGET_TOTAL_CELLS:'12000000',
  QUOTE_SHELL_FACTOR:'0.9', QUOTE_SOLID_FACTOR:'0.88', QUOTE_LARGE_PART_RESOLUTION_FACTOR:'0.85',
  QUOTE_MAX_LAYER_COUNT:'2500', QUOTE_MAX_LAYER_CELLS:'1000000', QUOTE_MAX_TRIANGLES:'300000',
  START_FEE:'50', PACKAGING_GRAMS:'30',
});
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
require.extensions['.ts'] = (mod, filename) => mod._compile(compile(fs.readFileSync(filename, 'utf8')), filename);
function baselineModule(relative) {
  const source = execFileSync('git', ['show', `${baselineRef}:${relative}`], { cwd: root, encoding: 'utf8' });
  const filename = path.join(root, path.dirname(relative), `baseline-${path.basename(relative)}`);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(compile(source), filename);
  return mod.exports;
}
const baselineEstimator = baselineModule('src/lib/estimation.ts');
const baselinePricing = baselineModule('src/lib/pricing.ts');
const currentEstimator = require('../src/lib/estimation.ts');
const currentPricing = require('../src/lib/pricing.ts');

let state = seed >>> 0;
function random() {
  state += 0x6D2B79F5;
  let value = state;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
}

function box([x,y,z]) {
  const points = [[0,0,0],[x,0,0],[x,y,0],[0,y,0],[0,0,z],[x,0,z],[x,y,z],[0,y,z]].map((p) => p.map((v,k) => v-[x,y,z][k]/2));
  return [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]].map((face) => face.map((index) => points[index]));
}

function sphere(radii, rings, sectors) {
  const points = Array.from({ length: rings+1 }, (_, ring) => Array.from({ length: sectors }, (_, sector) => {
    if (ring === 0) return [0,0,radii[2]];
    if (ring === rings) return [0,0,-radii[2]];
    const latitude = ring*Math.PI/rings;
    const longitude = sector*2*Math.PI/sectors;
    return [radii[0]*Math.sin(latitude)*Math.cos(longitude), radii[1]*Math.sin(latitude)*Math.sin(longitude), radii[2]*Math.cos(latitude)];
  }));
  const triangles = [];
  for (let ring=0;ring<rings;ring++) for(let sector=0;sector<sectors;sector++) {
    const next=(sector+1)%sectors;
    const a=points[ring][sector], b=points[ring+1][sector], c=points[ring+1][next], d=points[ring][next];
    if (ring<rings-1) triangles.push([a,b,c]);
    if (ring>0) triangles.push([a,c,d]);
  }
  return triangles;
}

function transform(triangles, rotation=[0,0,0], translation=[0,0,0]) {
  const [sx,sy,sz]=rotation.map(Math.sin), [cx,cy,cz]=rotation.map(Math.cos);
  return triangles.map((triangle) => triangle.map(([x,y,z]) => {
    const y1=y*cx-z*sx, z1=y*sx+z*cx;
    const x2=x*cy+z1*sy, z2=-x*sy+z1*cy;
    return [x2*cz-y1*sz+translation[0], x2*sz+y1*cz+translation[1], z2+translation[2]];
  }));
}

const families = ['axis-box','rotated-box','sphere','ellipsoid','overlapping-boxes','disconnected-boxes','hollow-shell','thin-plate','layer-boundaries','sphere-box-overlap'];
function makeCase(index) {
  const family = families[index % families.length];
  const size = [4,9,20,35,60,85,110,150,200,245][Math.floor(index/families.length)%10];
  const dimensions = [size, size*(0.3+random()*0.7), size*(0.3+random()*0.7)];
  const angles = Array.from({ length:3 }, () => (random()-0.5)*Math.PI*2);
  const shift = Array.from({ length:3 }, () => (random()-0.5)*400);
  let triangles;
  switch(family) {
    case 'axis-box': triangles=box(dimensions); break;
    case 'rotated-box': triangles=transform(box(dimensions),angles); break;
    case 'sphere': triangles=sphere([size/2,size/2,size/2],10+index%7,16+index%11); break;
    case 'ellipsoid': triangles=transform(sphere(dimensions.map((v)=>v/2),12+index%7,20+index%9),angles); break;
    case 'overlapping-boxes': triangles=[...box(dimensions), ...transform(box(dimensions), angles, [size*0.25,0,size*0.1])]; break;
    case 'disconnected-boxes': triangles=[...transform(box(dimensions),angles), ...transform(box(dimensions.map((v)=>v*0.6)),angles.map((v)=>-v),[size*1.5,0,size*1.3])]; break;
    case 'hollow-shell': triangles=[...box(dimensions), ...box(dimensions.map((v)=>v*0.7)).map((triangle)=>triangle.slice().reverse())]; triangles=transform(triangles,angles); break;
    case 'thin-plate': triangles=transform(box([dimensions[0],dimensions[1],[0.001,0.05,0.2,0.45,0.9][index%5]]),angles); break;
    case 'layer-boundaries': {
      const boundary=0.5+Math.floor(index/families.length);
      const gap=[0,1e-8,-1e-8][index%3];
      triangles=[...transform(box([size,size,boundary]),[0,0,0],[0,0,boundary/2]), ...transform(box([size/2,size/2,2]),[0,0,0],[0,0,boundary+1+gap])];
      break;
    }
    case 'sphere-box-overlap': triangles=[...sphere([size/2,size/2,size/2],14,22), ...transform(box(dimensions),angles,[size*0.3,0,0])]; break;
  }
  // Keep dedicated boundary cases anchored at Z=0; other cases also exercise negative and noninteger coordinates.
  if (family!=='layer-boundaries') triangles=transform(triangles,[0,0,0],shift);
  const material=['PLA','PETG','ABS','ASA','TPU'][Math.floor(index/families.length)%5];
  const format=['binary-stl','ascii-stl','obj'][index%3];
  return { family,size,dimensions,angles,shift,material,format,triangles,copies:1+Math.floor(random()*7) };
}

function writeMesh(filename, triangles, format) {
  if (format==='binary-stl') {
    const buffer=Buffer.alloc(84+triangles.length*50);
    buffer.writeUInt32LE(triangles.length,80);
    triangles.forEach((triangle,index)=>triangle.forEach((point,vertex)=>point.forEach((value,axis)=>buffer.writeFloatLE(value,84+index*50+12+vertex*12+axis*4))));
    fs.writeFileSync(filename,buffer);
  } else if (format==='ascii-stl') {
    fs.writeFileSync(filename,`solid validation\n${triangles.map((triangle)=>`facet normal 0 0 0\nouter loop\n${triangle.map((p)=>`vertex ${p.join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid validation\n`);
  } else {
    const vertices=triangles.flat();
    fs.writeFileSync(filename,`${vertices.map((p)=>`v ${p.join(' ')}`).join('\n')}\n${triangles.map((_,i)=>`f ${i*3+1} ${i*3+2} ${i*3+3}`).join('\n')}\n`);
  }
}

function numericDifferences(before,after,prefix='',differences=[]) {
  if (typeof before==='number' && typeof after==='number') {
    if (!Object.is(before,after)) differences.push({path:prefix,before,after,absolute:Math.abs(after-before),relative:Math.abs(after-before)/Math.max(Math.abs(before),Number.MIN_VALUE)});
  } else if (before && after && typeof before==='object' && typeof after==='object') {
    for (const key of new Set([...Object.keys(before),...Object.keys(after)])) numericDifferences(before[key],after[key],prefix?`${prefix}.${key}`:key,differences);
  }
  return differences;
}

fs.mkdirSync(output,{recursive:true});
const results=[];
const started=Date.now();
for(let index=0;index<caseCount;index++) {
  const fixture=makeCase(index);
  const extension=fixture.format==='obj'?'obj':'stl';
  const filename=path.join(output,`${String(index+1).padStart(3,'0')}-${fixture.family}.${extension}`);
  writeMesh(filename,fixture.triangles,fixture.format);
  const before=baselineEstimator.estimateFromFile(filename,fixture.material);
  const after=currentEstimator.estimateFromFile(filename,fixture.material);
  const entries=(estimate)=>[{index:0,name:path.basename(filename),material:fixture.material,color:'white',copies:fixture.copies,gramsEach:estimate.grams}];
  const beforePrice=baselinePricing.priceCartBreakdown(entries(before),1);
  const afterPrice=currentPricing.priceCartBreakdown(entries(after),1);
  const {triangles,...parameters}=fixture;
  results.push({index:index+1,...parameters,triangles:triangles.length,identicalEstimate:isDeepStrictEqual(before,after),identicalPrice:isDeepStrictEqual(beforePrice,afterPrice),numericDifferences:numericDifferences(before,after),before,after,beforePrice,afterPrice});
  if((index+1)%10===0 || index+1===caseCount) console.log(`Validated ${index+1}/${caseCount}: ${results.filter((r)=>!r.identicalEstimate||!r.identicalPrice).length} mismatches; ${Math.round((Date.now()-started)/1000)} seconds.`);
}
const allDifferences=results.flatMap((result)=>result.numericDifferences);
const summary={baselineRef,seed,caseCount,durationSeconds:Math.round((Date.now()-started)/1000),exactEstimateMatches:results.filter((r)=>r.identicalEstimate).length,exactPriceMatches:results.filter((r)=>r.identicalPrice).length,maxAbsoluteNumericDifference:Math.max(0,...allDifferences.map((d)=>d.absolute)),maxRelativeNumericDifference:Math.max(0,...allDifferences.map((d)=>d.relative)),families:[...new Set(results.map((r)=>r.family))],materials:[...new Set(results.map((r)=>r.material))],formats:[...new Set(results.map((r)=>r.format))]};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({summary,results},null,2));
console.log(JSON.stringify(summary,null,2));
console.log(`Detailed report: ${path.join(output,'report.json')}`);
if(summary.exactEstimateMatches!==caseCount||summary.exactPriceMatches!==caseCount) process.exitCode=1;
