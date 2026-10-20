// Reads the QR code of a Swiss QR-bill from a PDF or a photo, in the browser (nothing leaves the device).
// Loaded only when Christoph adds a bill (dynamic import), so the cockpit itself stays small.
import jsQR from "jsqr";

const MAX_SIDE = 2400; // photos from the phone are big; the QR is still sharp enough at this size
// decoders for scanned PDFs (CCITT G4, JBIG2, JPEG 2000): WebAssembly files served by the «qnh-pdfjs-wasm»
// plugin (vite.config.js) – an absolute folder URL ending in "/", so the worker resolves it the same way
const WASM_URL = new URL(`${import.meta.env.BASE_URL}pdfjs-wasm/`, location.href).href;

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// try the whole picture, then the lower half (the payment part sits at the bottom of the page)
function scan(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const tries = [[0, 0, canvas.width, canvas.height], [0, Math.floor(canvas.height / 2), canvas.width, Math.ceil(canvas.height / 2)]];
  for (const [x, y, w, h] of tries) {
    const img = ctx.getImageData(x, y, w, h);
    const hit = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" });
    if (hit?.data?.startsWith("SPC")) return hit.data;
  }
  return null;
}

async function fromImage(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = canvasOf(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return scan(c);
}

async function fromPdf(file) {
  // the «legacy» build brings polyfills: the modern one needs JavaScript that Safari/iPhone do not have yet
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { default: worker } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, wasmUrl: WASM_URL });
  const doc = await task.promise;
  try {
    // the QR-bill is usually on the last page
    for (let n = doc.numPages; n >= 1 && n > doc.numPages - 4; n--) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 2.5 });
      const c = canvasOf(Math.ceil(vp.width), Math.ceil(vp.height));
      await page.render({ canvas: c, canvasContext: c.getContext("2d"), viewport: vp }).promise;
      const text = scan(c);
      if (text) return text;
    }
    return null;
  } finally {
    await task.destroy?.(); // frees the worker
  }
}

// → the QR text ("SPC…") or null when no QR-bill is found
export async function readQrBill(file) {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return fromPdf(file);
  return fromImage(file);
}
