// End-to-end test: drives the real index.html in jsdom with a stubbed Groq API.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test/index.html', pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;

// ---- browser shims jsdom lacks ----
window.URL.createObjectURL = () => 'blob:mock';
window.URL.revokeObjectURL = () => {};
class FakeImage {
  set src(v) { this.width = 1400; this.height = 1000; setTimeout(() => this.onload && this.onload(), 0); }
}
window.Image = FakeImage;
window.HTMLCanvasElement.prototype.getContext = function () {
  return { fillRect() {}, drawImage() {} };
};
window.HTMLCanvasElement.prototype.toDataURL = function () {
  return 'data:image/jpeg;base64,QUJD';
};
window.alert = () => {};

const calls = [];
window.fetch = function (url, opts) {
  const body = JSON.parse(opts.body);
  const prompt = body.messages[0].content[0].text;
  const isProd = /PRODUCTION SHEET/.test(prompt);
  calls.push({ model: body.model, images: body.messages[0].content.length - 1, isProd, json: !!body.response_format, prompt });
  const content = isProd
    ? JSON.stringify({ ars2: { lul: '800/400, 400', ab: '3', bp: '22', rr: '2/1/0/0', ra: '120,130' },
                       ars3: { ars3ra: '80', ars3sa: '50p', ars3ba: '4' },
                       bath: { bathprod: '361', tanker: '9', bathstock: '115/157/420/457/475/450' },
                       warehouse: { whstock: '316/353/8/3', whsent: '612/94', whrcv: '692/102' },
                       sbh_mill: 'mill running', rmt: '', notes: 'page 2 footer was cropped' })
    : JSON.stringify({ events: [
                        { equipment: 'Loop-7', issue: 'torque overload', start: '14:30:00', end: '14:45:00', remarks: '' },
                        { equipment: 'BC-11', issue: 'choke', start: '16:00', end: '16:20', remarks: '' },
                        { equipment: 'Furnace-2', issue: 'trip', start: '', end: '', remarks: 'operator reset' }],
                       lines: ['Loop-7 torque overload 14:30 14:45', 'BC-11 choke 16:00 16:20', 'Furnace-2 trip'],
                       notes: 'one row partly hidden behind the toolbar' });
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content } }] })
  });
};

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '\n       got  ' + JSON.stringify(got) + '\n       want ' + JSON.stringify(want)); }
}
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '\n       ' + extra : '')); }
}
const $ = id => doc.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));

function addImages(id, n, namePrefix) {
  const input = $(id);
  const files = [];
  for (let i = 1; i <= n; i++) {
    files.push(new window.File([new Uint8Array([1, 2, 3, 4])], namePrefix + i + '.jpg', { type: 'image/jpeg' }));
  }
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new window.Event('change'));
  return files;
}

const PREV_REPORT = [
  '*Date:-27/09/2026*',
  '*Shift:-A*',
  '',
  '*ARS-2 PRODUCTION*',
  '• *LUL* Production (Target/Actual)- 800/800(400/400)',
  '•Rodded anodes (Cumulative)- 100(M)',
  '',
  '*ARS-3 PRODUCTION*',
  'RA production(FTS/FTD): 50/50',
  'SA processed: (FTS/FTD)- 200/200',
  'BA received(sets):(FTS/FTD)- 10/10',
  '',
  '*BATH HANDLING*',
  '•Cumulative bath- 900 mt',
  '•Tankers (cumulative)- 3 nos',
  '',
  'Regards',
  'Omkar & Santanu'
].join('\n');

(async function run() {
  await wait(50);

  console.log('--- boot ---');
  ok('app booted into phase 1', $('phase-prev-report').classList.contains('active'));
  ok('no leftover preview thumbs', $('prod-preview').children.length === 0);

  console.log('--- step 1: paste previous shift report ---');
  $('prev-report-input').value = PREV_REPORT;
  $('parse-btn').click();
  await wait(30);
  ok('advanced to phase 2', $('phase-section-select').classList.contains('active'));
  ok('next shift derived', /Shift B/.test($('shift-info-box').textContent), $('shift-info-box').textContent);
  ok('previous cumulatives parsed', /Prev Tanker Cum: 3/.test($('shift-info-box').textContent), $('shift-info-box').textContent);

  console.log('--- multi-image upload ---');
  addImages('prod-img', 4, 'prod-page');
  addImages('bd-img', 1, 'bd');
  ok('4 production thumbs rendered', $('prod-preview').children.length === 4, 'got ' + $('prod-preview').children.length);
  ok('1 breakdown thumb rendered', $('bd-preview').children.length === 1);
  ok('production count label', $('prod-count').textContent, '4 images ready');
  ok('clear button revealed', $('prod-clear').style.display, 'inline-flex');

  // remove the first thumbnail -> 3 left
  $('prod-preview').children[0].querySelector('button').click();
  ok('thumb removal works', $('prod-preview').children.length === 3);

  // put it back
  addImages('prod-img', 1, 'prod-extra');
  ok('re-added', $('prod-preview').children.length === 4);

  console.log('--- extract (stubbed Groq) ---');
  $('groq-key-input').value = 'gsk_test_key';
  $('ai-process-btn').click();
  await wait(400);

  const prodCalls = calls.filter(c => c.isProd);
  const bdCalls = calls.filter(c => !c.isProd);
  eq('4 production images batched into 2 calls (3+1)', prodCalls.map(c => c.images), [3, 1]);
  eq('1 breakdown image = 1 call', bdCalls.map(c => c.images), [1]);
  ok('uses a live vision model, not the dead id', calls.every(c => c.model === 'qwen/qwen3.8-27b'), JSON.stringify(calls.map(c => c.model)));
  ok('JSON mode requested', calls.every(c => c.json));
  ok('review card is open', $('review-card').style.display === 'block');
  ok('production prompt explicitly scans every column and section', /ENTIRE image, not just the first\/leftmost column/.test(calls.find(c => c.isProd).prompt) && /Warehouse \(stock, sent, received\)/.test(calls.find(c => c.isProd).prompt));
  ok('status shows success', /review/i.test($('extract-status').textContent), $('extract-status').textContent);

  console.log('--- review panel content ---');
  eq('LUL carried into review', $('rv_ars2_lul').value, '800/400, 400');
  eq('rodded anodes carried', $('rv_ars2_ra').value, '120,130');
  eq('SA value carried', $('rv_ars3_ars3sa').value, '50p');
  eq('bath production carried', $('rv_bath_bathprod').value, '361');
  eq('tankers carried', $('rv_bath_tanker').value, '9');
  eq('bath stock carried', $('rv_bath_bathstock').value, '115/157/420/457/475/450');
  eq('warehouse stock carried', $('rv_warehouse_whstock').value, '316/353/8/3');
  eq('warehouse sent carried', $('rv_warehouse_whsent').value, '612/94');
  eq('warehouse received carried', $('rv_warehouse_whrcv').value, '692/102');
  const bdLines = $('rv_bd').value.split('\n');
  eq('three breakdown events', bdLines.length, 3);
  ok('event 1 formatted with times', /^\*Loop-7, torque overload\(2:30PM-2:45PM\)/.test(bdLines[0]), bdLines[0]);
  ok('event 2 formatted with times', /^\*BC-11, choke\(4:00PM-4:20PM\)/.test(bdLines[1]), bdLines[1]);
  eq('untimed event kept with remarks', bdLines[2], '*Furnace-2, trip operator reset');
  ok('live preview mirrors the textarea', $('rv_bd_preview').textContent === $('rv_bd').value, $('rv_bd_preview').textContent);
  ok('model uncertainty surfaced', /footer was cropped/.test($('review-panel').textContent));
  ok('raw output hidden by default', $('rv-raw-block').classList.contains('hidden'));
  $('review-raw-btn').click();
  ok('raw output toggle works', !$('rv-raw-block').classList.contains('hidden'));

  console.log('--- operator edits before applying ---');
  $('rv_ars2_bp').value = '25';
  $('rv_bd').value = $('rv_bd').value.split('\n').slice(0, 2).join('\n');

  console.log('--- apply ---');
  $('review-apply-btn').click();
  await wait(50);

  ok('review card closed after apply', $('review-card').style.display === 'none');
  ok('undo offered', $('review-undo-btn').style.display === 'inline-flex');
  ok('apply summary names sections', /ARS-2 Production/.test($('extract-status').textContent), $('extract-status').textContent);

  const prev = $('preview-content').textContent;
  ok('ARS-2 section written', prev.includes('ARS-2 PRODUCTION'), prev.slice(0, 200));
  ok('LUL 400+400 -> 800/800(400/400)', prev.includes('800/800(400/400)'), prev);
  ok('operator edit of BP respected', prev.includes('250(120/130)/3/25'), prev);
  ok('rodded cumulative = prev 100 + 250', prev.includes('350(M)'), prev);
  ok('ARS-3 50p -> SA 200, FTD 200+200', prev.includes('SA processed: (FTS/FTD)- 200/400'), prev);
  ok('ARS-3 BA FTD = 10+4', prev.includes('BA received(sets):(FTS/FTD)- 4/14'), prev);
  ok('bath cumulative 900+361=1261', prev.includes('Cumulative bath- 1261 mt'), prev);
  ok('tanker cumulative 3+9=12', prev.includes('Tankers (cumulative)- 12 nos'), prev);
  ok('operator-kept breakdown rows applied', prev.includes('*BC-11, choke(4:00PM-4:20PM)'), prev);
  ok('row the operator deleted is NOT written', !prev.includes('Furnace-2'), prev);
  ok('SBH & Mill written', prev.includes('mill running'), prev);
  ok('total RA cumulative = 350+130', prev.includes('(Ars-2+Ars-3)=350+130=480'), prev);

  console.log('--- generated report ---');
  $('gen-btn').click();
  const out = $('report-output').textContent;
  ok('report contains breakdowns section', out.includes('BREAKDOWNS'), out.slice(0, 300));
  ok('report contains warehouse', out.includes('RAP/SAP/EBB/EAP - 316/353/8/3'), out);

  console.log('--- undo ---');
  $('edit-btn').click();
  $('review-undo-btn').click();
  await wait(50);
  const after = $('preview-content').textContent;
  ok('undo cleared the preview card', $('preview-card').style.display === 'none', $('preview-card').style.display);
  ok('undo restored pre-apply state', !after.includes('ARS-2 PRODUCTION'), after.slice(0, 200));
  ok('undo removed the cumulative', !after.includes('(Ars-2+Ars-3)'), after.slice(0, 200));
  ok('undo button hides itself', $('review-undo-btn').style.display === 'none', $('review-undo-btn').style.display);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('THREW:', e); process.exit(1); });
