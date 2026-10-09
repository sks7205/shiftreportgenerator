# Local OCR assets

These browser assets are served from the repository so GitHub Pages does not need a third-party OCR CDN or an AI API key.

- `tesseract.min.js` and `worker.min.js`: Tesseract.js 7.0.0 (Apache-2.0; see `LICENSE.tesseract.js.txt`).
- `tesseract-core-lstm.wasm.js`: tesseract.js-core 7.0.0, LSTM-only/WASM build (Apache-2.0; see `LICENSE.tesseract.js-core.txt`).
- `lang/eng.traineddata.gz`: English `4.0.0_best_int` trained data from `@tesseract.js-data/eng` 1.0.0 (package declares MIT; see its package metadata at https://registry.npmjs.org/@tesseract.js-data/eng).

The LSTM-only core is intentionally used for broad WASM compatibility. OCR runs locally in the browser. It is suitable for printed text but may misread handwriting; extracted values must be checked in the review panel before applying.
