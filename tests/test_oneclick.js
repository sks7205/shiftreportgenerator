// One-click flow: one production-sheet photo in, finished report out.
// Covers the three things that flow has to get right on its own - no key entry,
// the shift taken from the sheet heading, and the previous shift's running
// totals recovered from the device archive instead of a paste step.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const rawHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ARCHIVE_KEY = 'ars_report_archive_v1';

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '\n       ' + extra : '')); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// A completed Shift A report for 28/09, in exactly the shape the generator
// emits. Shift B follows Shift A on the same day, so this is the report a
// one-click run for 28/09 Shift B is expected to find and total up from.
const PREV_A = [
  '*Date:-28/09/2026*',
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

function prodContent(sheet) {
  return JSON.stringify({
    sheet: sheet || null,
    ars2: { lul: '800/400, 400', ab: '3', bp: '22', rr: '2/1/0/0', ra: '120,130' },
    ars3: { ars3ra: '80', ars3sa: '50p', ars3ba: '4' },
    bath: { bathprod: '361', tanker: '9', bathstock: '115/157/420/457/475/450' },
    warehouse: { whstock: '316/353/8/3', whsent: '612/94', whrcv: '692/102' },
    sbh_mill: '', rmt: '', notes: ''
  });
}

function boot(opts) {
  opts = opts || {};
  // Simulates the deployed site, where the workflow bakes the secret in, so the
  // operator never types a key. injectedKey:false is a fresh local file.
  const html = opts.injectedKey === false
    ? rawHtml
    : rawHtml.replace('const INJECTED_KEY = "__GROQ_API_KEY__";', 'const INJECTED_KEY = "gsk_injected";');

  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test/index.html', pretendToBeVisual: true });
  const { window } = dom;
  const doc = window.document;

  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
  class FakeImage { set src(v) { this.width = 1200; this.height = 900; setTimeout(() => this.onload && this.onload(), 0); } }
  window.Image = FakeImage;
  window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {} });
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,QUJD';
  const alerts = [];
  window.alert = m => alerts.push(m);

  const st = { sheet: opts.sheet };
  const calls = [];
  window.fetch = (url, o) => {
    const body = JSON.parse(o.body);
    const isProd = /PRODUCTION SHEET/.test(body.messages[0].content[0].text);
    calls.push({
      model: body.model,
      auth: o.headers.Authorization,
      isProd,
      imgs: body.messages[0].content.length - 1
    });
    const content = isProd
      ? prodContent(st.sheet)
      : JSON.stringify({ events: [], lines: [], notes: '' });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ choices: [{ message: { content } }] }) });
  };

  if (opts.archive) window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(opts.archive));

  return {
    window, doc, st, calls, alerts,
    $: id => doc.getElementById(id),
    archive: () => JSON.parse(window.localStorage.getItem(ARCHIVE_KEY) || '[]')
  };
}

function addPhoto(t, n) {
  const input = t.$('oneclick-img');
  const files = [];
  for (let i = 1; i <= (n || 1); i++) {
    files.push(new t.window.File([new Uint8Array([1, 2, 3, 4])], 'sheet-' + i + '.jpg', { type: 'image/jpeg' }));
  }
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new t.window.Event('change'));
}

(async function () {
  console.log('--- photo in, report out (deployed site, no key entry) ---');
  const t = boot({
    sheet: { date: '28/09/2026', shift: 'B' },
    archive: [{ date: '28/09/2026', shift: 'A', text: PREV_A, at: 1 }]
  });
  await wait(80);
  const $ = t.$;

  ok('starts on the paste step, untouched', $('phase-prev-report').classList.contains('active'));
  ok('no key is entered by the operator', $('groq-key-input').value === '');

  addPhoto(t, 2);
  await wait(800);

  ok('ran without asking for a key', t.calls.length > 0, 'calls: ' + t.calls.length);
  ok('used the injected deploy key', t.calls.every(c => c.auth === 'Bearer gsk_injected'), JSON.stringify(t.calls.map(c => c.auth)));
  ok('both pages went in one request', t.calls.every(c => c.imgs === 2), JSON.stringify(t.calls.map(c => c.imgs)));
  ok('called the live vision model', t.calls.every(c => c.model === 'qwen/qwen3.8-27b'), JSON.stringify(t.calls.map(c => c.model)));
  ok('no alert dialogs in the happy path', t.alerts.length === 0, JSON.stringify(t.alerts));

  ok('shift read from the sheet heading', $('header-shift').textContent === '28/09/2026 / B', $('header-shift').textContent);
  ok('previous totals found in the archive',
    /Prev Tanker Cum: 3/.test($('shift-info-box').textContent) && /Prev Bath Cum: 900/.test($('shift-info-box').textContent),
    $('shift-info-box').textContent);
  ok('no paste step needed', $('prev-report-input').value === PREV_A, 'paste box left: ' + $('prev-report-input').value.slice(0, 40));

  ok('report shown straight away', $('phase-report-out').classList.contains('active'));
  const out = $('report-output').textContent;
  ok('LUL formatted like the manual form', out.includes('800/800(400/400)'), out.slice(0, 200));
  ok('bath cumulative 900+361', out.includes('Cumulative bath- 1261 mt'), out);
  ok('tanker cumulative 3+9', out.includes('Tankers (cumulative)- 12 nos'), out);
  ok('rodded cumulative 100+250', out.includes('350(M)'), out);
  ok('total RA cumulative 350+130', out.includes('(Ars-2+Ars-3)=350+130=480'), out);
  ok('photos consumed after the run', $('oneclick-preview').children.length === 0 && $('oneclick-count').textContent === 'No images',
    $('oneclick-count').textContent + ' / ' + $('oneclick-preview').children.length + ' thumbs');
  ok('button freed for the next sheet', $('oneclick-btn').disabled === false);
  ok('status names the shift built', /Report built for 28\/09\/2026 - Shift B/.test($('oneclick-status').textContent), $('oneclick-status').textContent);
  ok('review affordance offered', $('oneclick-review-btn').style.display === 'inline-flex');
  ok('flag-free run says so', /Nothing was flagged/.test($('oneclick-status').textContent), $('oneclick-status').textContent);

  console.log('--- the finished report is archived for the next shift ---');
  const arch = t.archive();
  ok('archive gained the B report', arch.length === 2 && arch[0].date === '28/09/2026' && arch[0].shift === 'B', JSON.stringify(arch.map(r => r.date + ' ' + r.shift)));
  ok('newest first', arch[1].date === '28/09/2026' && arch[1].shift === 'A', JSON.stringify(arch.map(r => r.date + ' ' + r.shift)));
  ok('archived text is what was shown', arch[0].text === out, arch[0].text.slice(0, 60));

  console.log('--- next shift chains off it, and C closes the day ---');
  t.st.sheet = { date: '28/09/2026', shift: 'C' };
  addPhoto(t, 1);
  await wait(800);
  ok('shift C now showing', $('header-shift').textContent === '28/09/2026 / C', $('header-shift').textContent);
  ok('B totals picked up as previous', /Prev Bath Cum: 1261/.test($('shift-info-box').textContent), $('shift-info-box').textContent);
  const out2 = $('report-output').textContent;
  // Shift C is the day-closing shift, so the running totals reset to FTS figures.
  ok('C resets bath to 361', out2.includes('Cumulative bath- 361 mt'), out2);
  ok('C resets rodded to 250', out2.includes('250(M)'), out2);
  ok('previous sections dropped from the new shift', !out2.includes('1261'), out2);
  ok('report for C archived too', t.archive()[0].date === '28/09/2026' && t.archive()[0].shift === 'C', JSON.stringify(t.archive().map(r => r.date + ' ' + r.shift)));

  console.log('--- check readings reopens the panel for corrections ---');
  $('oneclick-review-btn').click();
  await wait(60);
  ok('back on the sections phase', $('phase-section-select').classList.contains('active'));
  ok('review panel reopened', $('review-card').style.display === 'block');
  ok('readings shown for editing', $('rv_ars2_lul').value === '800/400, 400', $('rv_ars2_lul').value);
  $('rv_ars2_bp').value = '25';
  $('review-apply-btn').click();
  await wait(60);
  ok('correction applied', /Applied to:/.test($('extract-status').textContent), $('extract-status').textContent);
  ok('preview carries the edit', $('preview-content').textContent.includes('250(120/130)/3/25'), $('preview-content').textContent);

  console.log('--- archived entry that contradicts its own heading ---');
  // Defensive path: if an archived report is keyed to one shift but its text
  // says another (hand-edited store, older build), the sheet heading must still
  // win and say so - never quietly file the report under the wrong shift.
  const skewed = boot({
    sheet: { date: '28/09/2026', shift: 'B' },
    archive: [{ date: '28/09/2026', shift: 'A', text: PREV_A.replace('28/09/2026', '27/09/2026'), at: 1 }]
  });
  await wait(80);
  addPhoto(skewed, 1);
  await wait(800);
  ok('sheet heading wins over the skewed entry', skewed.$('header-shift').textContent === '28/09/2026 / B', skewed.$('header-shift').textContent);
  ok('contradiction reported', /the sheet wins/.test(skewed.$('oneclick-status').textContent), skewed.$('oneclick-status').textContent);
  ok('totals still taken from it', /Prev Bath Cum: 900/.test(skewed.$('shift-info-box').textContent), skewed.$('shift-info-box').textContent);

  console.log('--- fresh device: nothing archived yet ---');
  const fresh = boot({ sheet: { date: '28/09/2026', shift: 'B' } });
  await wait(80);
  addPhoto(fresh, 1);
  await wait(800);
  const fstat = fresh.$('oneclick-status').textContent;
  ok('report still built', fresh.$('phase-report-out').classList.contains('active'));
  ok('missing previous shift named', /No archived report for 28\/09\/2026 Shift A/.test(fstat), fstat);
  ok('flag surfaces in the status', /Flagged:/.test(fstat), fstat);
  const fout = fresh.$('report-output').textContent;
  ok('totals start at this shift', fout.includes('Cumulative bath- 361 mt'), fout);
  ok('shift heading still applied', fresh.$('header-shift').textContent === '28/09/2026 / B', fresh.$('header-shift').textContent);

  console.log('--- sheet heading unreadable ---');
  const noHead = boot({ sheet: null, archive: [{ date: '28/09/2026', shift: 'A', text: PREV_A, at: 1 }] });
  await wait(80);
  addPhoto(noHead, 1);
  await wait(800);
  ok('falls back to the clock', /^\d{2}\/\d{2}\/\d{4} \/ [ABC]$/.test(noHead.$('header-shift').textContent), noHead.$('header-shift').textContent);
  ok('says the clock was used', /device clock/.test(noHead.$('oneclick-status').textContent), noHead.$('oneclick-status').textContent);
  ok('no bogus date invented', !/1899|NaN/.test(noHead.$('header-shift').textContent), noHead.$('header-shift').textContent);

  console.log('--- unreadable sheet: nothing to write ---');
  const blank = boot({});
  await wait(80);
  blank.st.sheet = undefined;
  const origFetch = blank.window.fetch;
  blank.window.fetch = (u, o) => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content: '{"notes":"photo is blurred"}' } }] })
  });
  addPhoto(blank, 1);
  await wait(600);
  ok('refuses to build an empty report', blank.$('oneclick-status').textContent.includes('read no figures'), blank.$('oneclick-status').textContent);
  ok('stays on the start step', blank.$('phase-prev-report').classList.contains('active'));
  blank.window.fetch = origFetch;

  console.log('--- local file with no key saved ---');
  const noKey = boot({ injectedKey: false, sheet: { date: '28/09/2026', shift: 'B' } });
  await wait(80);
  addPhoto(noKey, 1);
  await wait(400);
  ok('does not call the API without a key', noKey.calls.length === 0, JSON.stringify(noKey.calls));
  ok('explains what is missing', /No Groq key on this device/.test(noKey.$('oneclick-status').textContent), noKey.$('oneclick-status').textContent);
  ok('opens the key panel', noKey.$('key-config-wrap').style.display === 'block');
  ok('button re-enabled', noKey.$('oneclick-btn').disabled === false);

  console.log('--- API failure during one-click ---');
  const broken = boot({ sheet: { date: '28/09/2026', shift: 'B' } });
  await wait(80);
  broken.window.fetch = () => Promise.resolve({
    ok: false, status: 429,
    json: () => Promise.resolve({ error: { message: 'Rate limit reached' } })
  });
  addPhoto(broken, 1);
  await wait(600);
  ok('failure surfaced in the one-click status', /Rate limited/i.test(broken.$('oneclick-status').textContent), broken.$('oneclick-status').textContent);
  ok('no half-written report', !broken.$('phase-report-out').classList.contains('active'));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('THREW:', e); process.exit(1); });
