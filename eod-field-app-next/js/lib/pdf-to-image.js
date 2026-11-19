/* Port of live EOD pdfToImage (EOD/index.html) — pdf.js 3.11.174, all pages. */
(function (global) {
  'use strict';

  const PDFJS_VER = '3.11.174';
  const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}`;
  const PDFJS_SRC = `${PDFJS_BASE}/build/pdf.min.js`;
  const PDFJS_WORKER = `${PDFJS_BASE}/build/pdf.worker.min.js`;
  const PDFJS_CMAPS = `${PDFJS_BASE}/cmaps/`;
  const PDFJS_FONTS = `${PDFJS_BASE}/standard_fonts/`;

  let pdfjsReady = null;

  function ensurePdfJs() {
    if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
    if (pdfjsReady) return pdfjsReady;
    const loader = global.EodAssetLoader;
    pdfjsReady = (loader
      ? loader.loadScript(PDFJS_SRC, { test: () => !!global.pdfjsLib, value: () => global.pdfjsLib })
      : Promise.reject(new Error('Dependency loader unavailable')))
      .then(() => {
        if (!global.pdfjsLib) throw new Error('PDF.js did not initialize');
        global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        return global.pdfjsLib;
      })
      .catch((err) => {
        pdfjsReady = null;
        throw err;
      });
    return pdfjsReady;
  }

  function toUint8Array(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      return null;
    }
    if (typeof input === 'string') {
      const raw = input.replace(/^data:application\/pdf;base64,/i, '');
      const binary = atob(raw);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    throw new Error('Unsupported PDF input');
  }

  /**
   * Render every PDF page to a JPEG data URL.
   * Matches live EOD: scale 2, jpeg quality 0.85.
   * @returns {Promise<Array<{ page: number, dataUrl: string }>>}
   */
  async function pdfToJpegPages(input, { scale = 2, quality = 0.85 } = {}) {
    const pdfjs = await ensurePdfJs();
    let bytes = toUint8Array(input);
    if (!bytes && typeof Blob !== 'undefined' && input instanceof Blob) {
      bytes = new Uint8Array(await input.arrayBuffer());
    }
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      cMapUrl: PDFJS_CMAPS,
      cMapPacked: true,
      standardFontDataUrl: PDFJS_FONTS,
    });
    const pdf = await loadingTask.promise;
    const pages = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      pages.push({
        page: pageNum,
        dataUrl: canvas.toDataURL('image/jpeg', quality),
      });
    }
    return pages;
  }

  /** First page only — same contract as live EOD pdfToImage(pdfBase64). */
  async function pdfToImage(pdfBase64) {
    const pages = await pdfToJpegPages(pdfBase64, { scale: 2, quality: 0.85 });
    if (!pages.length) throw new Error('PDF has no pages');
    return pages[0].dataUrl;
  }

  global.EodPdfToImage = {
    ensurePdfJs,
    pdfToJpegPages,
    pdfToImage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
