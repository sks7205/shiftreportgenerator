// Error-path and fallback tests for the extraction flow (Arena gateway transport).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const rawHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '\n       ' + extra : '')); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// htmlTransform lets a test pre-seed a setting the page reads at load time
// (the model override), the same way the deploy workflow rewrites the key.
function boot(fetchImpl, htmlTransform) {
  const html = htmlTransform ? htmlTransform(rawHtml) : rawHtml;
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
  console.log('--- gateway refuses the model id (400) ---');
  {
    const bodies = [];
    const t = boot((url, o) => {
      bodies.push(JSON.parse(o.body));
      return Promise.resolve(errResponse(400, 'The model `coding-router-preview` is no longer supported.'));
    });
    await wait(60);
    addProd(t.$); t.$('arena-key-input').value = 'arena_x';
    t.$('ai-process-btn').click();
    await wait(300);
    const s = t.$('extract-status') ? t.$('extract-status').textContent : '<<NULL ELEMENT>>';
    ok('fails gracefully', /Extraction failed/.test(s), s);
    ok('surfaces the gateway error', /no longer supported/.test(s), s);
    ok('tells the operator what to do', /coding-router-preview|API key/i.test(s), s);
    ok('retries once with the plain body', bodies.length === 2, 'calls: ' + bodies.length);
    ok('full body asked for JSON mode', !!bodies[0].response_format);
    ok('plain body dropped it', !bodies[1].response_format && !bodies[1].max_completion_tokens);
    ok('status styled as an error', t.$('extract-status').className.includes('err'));
    ok('button re-enabled for a retry', t.$('ai-process-btn').disabled === false);
  }

  console.log('--- 403: key locked to the Arena router ---');
  {
    const t = boot(() => Promise.resolve(errResponse(403, 'This account can only use the coding router.')));
    await wait(60);
    addProd(t.$); t.$('arena-key-input').value = 'arena_x';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('does not hammer the gateway with other models', /Extraction failed/.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
    ok('explains the router restriction', /coding-router-preview/.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
  }

  console.log('--- body rejected, plain body accepted (parameter fallback) ---');
  {
    let n = 0;
    const bodies = [];
    const t = boot((url, o) => {
      bodies.push(JSON.parse(o.body));
      n++;
      if (n === 1) return Promise.resolve(errResponse(400, 'Unsupported parameter: response_format'));
      return Promise.resolve(jsonResponse(JSON.stringify({ ars2: { bp: '7' } })));
    });
    await wait(60);
    addProd(t.$); t.$('arena-key-input').value = 'arena_x';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('recovered on the retry', t.$('review-card').style.display === 'block', t.$('extract-status').textContent);
    ok('recovered value shown', t.$('rv_ars2_bp').value === '7', t.$('rv_ars2_bp').value);
    ok('same model retried, not a different one', bodies[0].model === bodies[1].model, JSON.stringify(bodies.map(b => b.model)));
  }

  console.log('--- named model dies, router still answers (model fallback) ---');
  {
    let n = 0;
    const models = [];
    const t = boot((url, o) => {
      const body = JSON.parse(o.body);
      models.push(body.model);
      n++;
      // Two rejections cover the named model's two body variants.
      if (n <= 2) return Promise.resolve(errResponse(404, 'model_not_found: custom-vision'));
      return Promise.resolve(jsonResponse(JSON.stringify({ ars2: { bp: '9' } })));
    }, html => html.replace("(localStorage.getItem('ars_arena_model') || '')", "'custom-vision'"));
    await wait(60);
    addProd(t.$); t.$('arena-key-input').value = 'arena_x';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('named model tried first', models[0] === 'custom-vision', JSON.stringify(models));
    ok('fell back to the Arena router', models[models.length - 1] === 'coding-router-preview', JSON.stringify(models));
    ok('recovered value shown', t.$('rv_ars2_bp').value === '9', t.$('rv_ars2_bp').value);
  }

  console.log('--- rate limited ---');
  {
    const t = boot(() => Promise.resolve(errResponse(429, 'Rate limit reached for the Arena router')));
    await wait(60);
    addProd(t.$); t.$('arena-key-input').value = 'arena_x';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('does not silently retry other models on 429', t.$('review-card').style.display === 'none');
    ok('rate-limit hint shown', /Rate limited/i.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
  }

  console.log('--- bad API key ---');
  {
    const t = boot(() => Promise.resolve(errResponse(401, 'Invalid API Key')));
    await wait(60);
    addProd(t.$); t.$('arena-key-input').value = 'arena_bad';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('points at the API key setting', /API key/i.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
  }

  console.log('--- model answers with content blocks instead of a string ---');
  {
    const t = boot(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content: [{ type: 'text', text: '{"ars2":{"bp":"5"}}' }] } }] })
    }));
    await wait(60);
    addProd(t.$); t.$('arena-key-input').value = 'arena_x';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('block-shaped answer read', t.$('rv_ars2_bp').value === '5', t.$('rv_ars2_bp').value);
  }

  console.log('--- model returns prose instead of JSON ---');
  {
    const t = boot(() => Promise.resolve(jsonResponse('I cannot read this image clearly enough.')));
    await wait(60);
    addProd(t.$); t.$('arena-key-input').value = 'arena_x';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('reports unreadable output', /did not return valid JSON/i.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
    ok('no bogus review panel', t.$('review-card').style.display === 'none');
  }

  console.log('--- model returns JSON but finds nothing ---');
  {
    const t = boot(() => Promise.resolve(jsonResponse('{}')));
    await wait(60);
    addProd(t.$); t.$('arena-key-input').value = 'arena_x';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('asks for a better image', /sharper|readable/i.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
  }

  console.log('--- network failure ---');
  {
    const t = boot(() => Promise.reject(new Error('Failed to fetch')));
    await wait(60);
    addProd(t.$); t.$('arena-key-input').value = 'arena_x';
    t.$('ai-process-btn').click();
    await wait(300);
    ok('network error surfaced', /Failed to fetch/.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
    ok('names the gateway it could not reach', /Arena gateway could not be reached/.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
  }

  console.log('--- guards ---');
  {
    const t = boot(() => Promise.resolve(jsonResponse('{}')));
    await wait(60);
    t.$('arena-key-input').value = 'arena_x';
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
  {
    const t = boot(() => Promise.resolve(jsonResponse('{}')));
    await wait(60);
    t.$('arena-key-input').value = 'arena_local';
    t.$('save-key-btn').click();
    ok('saving a key closes the panel', t.$('key-config-wrap').style.display === 'none');
    ok('key stored under the Arena key name', t.window.localStorage.getItem('ars_arena_api_key') === 'arena_local',
       String(t.window.localStorage.getItem('ars_arena_api_key')));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('THREW:', e); process.exit(1); });
