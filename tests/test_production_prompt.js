// Regressions for local OCR assets, image extraction guidance, and review safeguards.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'static.yml'), 'utf8');
const vendor = path.join(__dirname, '..', 'vendor', 'ocr');

let pass = 0, fail = 0;
function ok(label, condition) {
  if (condition) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}

console.log('--- browser-local OCR extraction coverage ---');
ok('one-click photo-to-report section remains removed', !/One-Click - Photo Straight to Report|oneclick-btn|oneclick-review-btn/.test(html));
ok('extractor is explicitly local and uses no cloud AI/API key', /Local OCR Auto-Extract \(No Cloud AI\/API Key\)/.test(html) && /no generative AI/i.test(html));
ok('Tesseract browser library is loaded from the repo', /src="\.\/vendor\/ocr\/tesseract\.min\.js"/.test(html));
ok('worker, OCR core, and English model paths are configured', /worker\.min\.js/.test(html) && /tesseract-core-lstm\.wasm\.js/.test(html) && /langPath: ocrAssetUrl\('lang'\)/.test(html));
ok('the required OCR assets are vendored for GitHub Pages',
  ['tesseract.min.js','worker.min.js','tesseract-core-lstm.wasm.js','lang/eng.traineddata.gz'].every(file => fs.existsSync(path.join(vendor, file))));
ok('full-sheet production parsing covers all values', /extractProductionOcr/.test(html) && /RAP\/SAP\/EBB\/EAP/.test(html) && /RBS\?1\|R1/.test(html));
ok('handwriting limitation and manual review warning are shown', /handwritten entries can be misread/i.test(html) && /correct anything OCR misread/i.test(html));
ok('raw OCR output is available to the operator', /Raw OCR text/.test(html) && /confidence/.test(html));
ok('no AI provider or key remains in the extractor', !/GEMINI_API_KEY|GROQ_API_KEY|generativelanguage\.googleapis\.com|api\.groq\.com|gemini-key-input|groq-key-input/.test(html));
ok('static workflow stages the OCR files with the page', /cp -R vendor _site\/vendor/.test(workflow));
ok('static workflow does not inject any secret', !/Inject Secret|secrets\.GROQ_API_KEY|GEMINI_API_KEY/.test(workflow));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
