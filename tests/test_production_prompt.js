// Regressions for the removed one-click section and complete-sheet OCR guidance.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, condition) {
  if (condition) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}

console.log('--- production extraction coverage ---');
ok('one-click photo-to-report section removed', !/One-Click - Photo Straight to Report|oneclick-btn|oneclick-review-btn/.test(html));
ok('all-column scan is required', /ENTIRE image, not just the first\/leftmost column/.test(html));
ok('production, bath, and warehouse checklist is explicit', /Bath Handling \(bath production, tankers, all six bath stock values\)/.test(html) && /Warehouse \(stock, sent, received\)/.test(html));
ok('missing fields must not cause bath/warehouse objects to be omitted', /Do not omit the bath or warehouse objects/.test(html));
ok('higher image detail retained for sheet photos', /const MAX_IMAGE_EDGE = 2600;\s*const JPEG_QUALITY = 0\.90;/.test(html));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
