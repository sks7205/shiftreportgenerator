// Error-path tests for the local, no-AI OCR extraction flow.
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

function boot(options) {
  options = options || {};
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test/index.html', pretendToBeVisual: true });
  const { window } = dom, doc = window.document;
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
  class FakeImage { set src(v) { this.width = 800; this.height = 600; setTimeout(() => this.onload && this.onload(), 0); } }
  window.Image = FakeImage;
  window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {} });
  let alerted = null, networkCalls = 0, workerCalls = 0;
  window.alert = m => { alerted = m; };
  window.fetch = () => { networkCalls++; return Promise.reject(new Error('Unexpected remote request')); };
  if (!options.noEngine) {
    window.Tesseract = {
      createWorker: async function(language, oem, workerOptions) {
        workerCalls++;
        if (options.createWorkerError) throw new Error(options.createWorkerError);
        return {
          setParameters: async () => {},
          recognize: async () => {
            if (options.recognizeError) throw new Error(options.recognizeError);
            return { data: { text: options.text || '', confidence: options.confidence === undefined ? 80 : options.confidence } };
          },
          terminate: async () => {}
        };
      }
    };
  }
  return {
    window, doc, $: id => doc.getElementById(id), alerted: () => alerted,
    networkCalls: () => networkCalls, workerCalls: () => workerCalls
  };
}

function addProd($) {
  const input = $('prod-img');
  const f = new ($('prod-img').ownerDocument.defaultView.File)([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' });
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  input.dispatchEvent(new ($('prod-img').ownerDocument.defaultView.Event)('change'));
}

(async function () {
  console.log('--- missing local OCR engine ---');
  {
    const t = boot({ noEngine: true });
    await wait(40);
    addProd(t.$);
    t.$('ai-process-btn').click();
    await wait(150);
    ok('explains that bundled OCR did not load', /local OCR engine|Tesseract/i.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
    ok('offers a retry hint', /reload|vendor\/ocr/i.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
    ok('button is re-enabled', t.$('ai-process-btn').disabled === false);
    ok('does not contact a remote API', t.networkCalls() === 0);
  }

  console.log('--- local OCR engine initialization failure ---');
  {
    const t = boot({ createWorkerError: 'Failed to initialize Tesseract worker' });
    await wait(40);
    addProd(t.$);
    t.$('ai-process-btn').click();
    await wait(150);
    ok('worker failure is surfaced', /OCR extraction failed|Tesseract/i.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
    ok('no result card is shown', t.$('review-card').style.display === 'none');
    ok('worker initialization was attempted', t.workerCalls() === 1);
  }

  console.log('--- OCR confidence and extracted value are visible for review ---');
  {
    const t = boot({ text: 'ARS-2 PRODUCTION\nLUL: 700/500', confidence: 24 });
    await wait(40);
    addProd(t.$);
    t.$('ai-process-btn').click();
    await wait(200);
    ok('review is shown even for low confidence so operator can correct it', t.$('review-card').style.display === 'block');
    ok('parsed value is editable', t.$('rv_ars2_lul').value === '700/500', t.$('rv_ars2_lul').value);
    ok('low OCR confidence is recorded in raw transcript', /confidence 24%/.test(t.$('rv-raw-block').textContent));
    ok('operator warning is explicit', /verify every value/i.test(t.$('review-panel').textContent));
  }

  console.log('--- OCR finds no readable values ---');
  {
    const t = boot({ text: '', confidence: 0 });
    await wait(40);
    addProd(t.$);
    t.$('ai-process-btn').click();
    await wait(200);
    ok('asks for a clearer image or manual entry', /raw OCR text|manually/i.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
    ok('opens review so the raw OCR output is still accessible', t.$('review-card').style.display === 'block' && t.$('rv-raw-block').textContent.includes('p.jpg'));
    ok('manual fields remain available when OCR finds no data', !!t.$('rv_ars2_lul') && !!t.$('rv_bd'));
  }

  console.log('--- OCR recognition runtime failure ---');
  {
    const t = boot({ recognizeError: 'WASM memory allocation failed' });
    await wait(40);
    addProd(t.$);
    t.$('ai-process-btn').click();
    await wait(200);
    ok('recognition error is visible', /WASM memory allocation failed/i.test(t.$('extract-status').textContent), t.$('extract-status').textContent);
    ok('button is re-enabled after failure', t.$('ai-process-btn').disabled === false);
  }

  console.log('--- guards ---');
  {
    const t = boot({ text: 'LUL: 500/400' });
    await wait(40);
    t.$('ai-process-btn').click();
    await wait(100);
    ok('no images -> warns instead of running OCR', /select a production sheet image/i.test(t.alerted()), String(t.alerted()));
    ok('no API key or AI key field exists', !t.$('gemini-key-input') && !t.$('groq-key-input'));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('THREW:', e); process.exit(1); });
