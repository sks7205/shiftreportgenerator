// Error-path and fallback tests for the extraction flow.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '\n       ' + extra : '')); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

function boot(fetchImpl) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test/index.html', pretendToBeVisual: true });
  const { window } = dom, doc = window.document;
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
  class FakeImage { set src(v) { this.width = 800; this.height = 600; setTimeout(() => this.onload && this.onload(), 0); } }
  window.Image = FakeImage;
  window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {} });
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,QUJD';
  let alerted = null;
  window.alert = m => { alerted = m; };
  window.fetch = fetchImpl;
  return { window, doc, $: id => doc.getElementById(id), alerted: () => alerted };
}

function addProd($) {
  const input = $('prod-img');
  const f = new ($('prod-img').ownerDocument.defaultView.File)([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' });
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  input.dispatchEvent(new ($('prod-img').ownerDocument.defaultView.Event)('change'));
}

function jsonResponse(content) {
  return { ok: true, status: 200, json: () => Promise.resolve({ choices: [{ message: { content } }] }) };
}
function errResponse(status, message) {
  return { ok: false, status, json: () => Promise.resolve({ error: { message } }) };
}

(async function () {
  console.log('--- every vision model decommissioned ---');
  {
    const t = boot(() => Promise.resolve(errResponse(400, 'The model `qwen/qwen3.8-27b` has been decommissioned and is no longer supported.')));
    await wait(60);
    addProd(t.$); t.$('groq-key-input').value = 'gsk_x';
    t.$('ai-process-btn').click();
    await wait(300);
    const s = t.$('extract-status') ? t.$('extract-status').textContent : '<<NULL ELEMENT>>';
    ok('fails gracefully', /Extraction failed/.test(s), s);
    ok('surfaces the model error', /decommissioned/.test(s), s);
    ok('tells the operator what to do', /own model id|API Key/i.test(s), s);
    ok('status styled as an error', t.$('extract-status').className.includes('err'));
    ok('button re-enabled for a retry', t.$('ai-process-btn').disabled === false);
  }

  console.log('--- first model 400s, second works (fallback) ---');
  {
    let n = 0;
    const t = boot(() => {
      n++;
      if (n === 1) return Promise.resolve(errResponse(400, 'model not found'));
      return Promise.resolve(jsonResponse(JSON.stringify({ ars2: { bp: '7' } })));
    });
    await wait(60);
    addProd(t.$); t.$('groq-key-input').value = 'gsk_x';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('fell back to the second model', t.$('review-card').style.display === 'block', t.$('extract-status').textContent);
    ok('recovered value shown', t.$('rv_ars2_bp').value === '7', t.$('rv_ars2_bp').value);
  }

  console.log('--- rate limited ---');
  {
    const t = boot(() => Promise.resolve(errResponse(429, 'Rate limit reached for qwen/qwen3.8-27b')));
    await wait(60);
    addProd(t.$); t.$('groq-key-input').value = 'gsk_x';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('does not silently retry other models on 429', t.$('review-card').style.display === 'none');
    ok('rate-limit hint shown', /Rate limited/i.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
  }

  console.log('--- bad API key ---');
  {
    const t = boot(() => Promise.resolve(errResponse(401, 'Invalid API Key')));
    await wait(60);
    addProd(t.$); t.$('groq-key-input').value = 'gsk_bad';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('points at the API key setting', /API key/i.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
  }

  console.log('--- model returns prose instead of JSON ---');
  {
    const t = boot(() => Promise.resolve(jsonResponse('I cannot read this image clearly enough.')));
    await wait(60);
    addProd(t.$); t.$('groq-key-input').value = 'gsk_x';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('reports unreadable output', /did not return valid JSON/i.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
    ok('no bogus review panel', t.$('review-card').style.display === 'none');
  }

  console.log('--- model returns JSON but finds nothing ---');
  {
    const t = boot(() => Promise.resolve(jsonResponse('{}')));
    await wait(60);
    addProd(t.$); t.$('groq-key-input').value = 'gsk_x';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('asks for a better image', /sharper|readable/i.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
  }

  console.log('--- network failure ---');
  {
    const t = boot(() => Promise.reject(new Error('Failed to fetch')));
    await wait(60);
    addProd(t.$); t.$('groq-key-input').value = 'gsk_x';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('network error surfaced', /Failed to fetch/.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
  }

  console.log('--- guards ---');
  {
    const t = boot(() => Promise.resolve(jsonResponse('{}')));
    await wait(60);
    t.$('groq-key-input').value = 'gsk_x';
    t.$('ai-process-btn').click();
    await wait(200);
    ok('no images -> warns instead of calling the API', /select a production sheet image/i.test(t.alerted()), String(t.alerted()));
  }
  {
    const t = boot(() => Promise.resolve(jsonResponse('{}')));
    await wait(60);
    addProd(t.$);
    t.$('ai-process-btn').click();   // no key entered
    await wait(200);
    ok('no key -> asks for a key', /API key/i.test(t.alerted()), String(t.alerted()));
    ok('key panel opened', t.$('key-config-wrap').style.display === 'block');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('THREW:', e); process.exit(1); });
