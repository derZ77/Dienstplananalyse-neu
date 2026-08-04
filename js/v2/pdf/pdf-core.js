import { getDocument, GlobalWorkerOptions } from '../../../vendor/pdfjs/pdf.mjs';
import { combineBoundingBoxes, reconstructLines, reconstructTablesAndBlocks } from './layout-reconstruction.js';

GlobalWorkerOptions.workerSrc = new URL('../../../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;

/**
 * Extracts a neutral PdfLayoutDocument. It deliberately contains no profile,
 * timetable, activity or business interpretation.
 */
export async function extractPdfLayoutDocument(input) {
  const bytes = await toBytes(input);
  const loadingTask = getDocument({
    data: bytes,
    disableWorker: true,
    disableAutoFetch: true,
    disableStream: true,
    useWorkerFetch: false
  });

  try {
    const pdf = await loadingTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      pages.push(await extractPage(pdf, pageNumber));
    }
    return {
      type: 'PdfLayoutDocument',
      pageCount: pdf.numPages,
      pages,
      source: { byteLength: bytes.byteLength }
    };
  } finally {
    await loadingTask.destroy();
  }
}

async function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input?.arrayBuffer) return new Uint8Array(await input.arrayBuffer());
  throw new TypeError('PDF input must be a Uint8Array, ArrayBuffer or File-like object.');
}

async function extractPage(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
  const textContent = await page.getTextContent();
  const textObjects = textContent.items.map((item, objectIndex) => createTextObject(item, textContent.styles[item.fontName], pageNumber, objectIndex));
  const lines = reconstructLines(textObjects);
  const pageBox = { xMin: 0, yMin: 0, xMax: viewport.width, yMax: viewport.height };
  const { tables, serviceBlocks } = reconstructTablesAndBlocks(lines, pageNumber, pageBox);

  return {
    number: pageNumber,
    size: { width: viewport.width, height: viewport.height, unit: 'pt' },
    rotation: page.rotate,
    boundingBox: pageBox,
    textObjects,
    lines,
    tables,
    serviceBlocks,
    source: { pageNumber, view: [...page.view] }
  };
}

function createTextObject(item, style, pageNumber, objectIndex) {
  const [scaleX, skewY, skewX, scaleY, x, y] = item.transform;
  const width = Math.abs(item.width);
  const height = Math.abs(item.height || scaleY);
  const boundingBox = {
    xMin: Math.min(x, x + width),
    yMin: Math.min(y, y + height),
    xMax: Math.max(x, x + width),
    yMax: Math.max(y, y + height)
  };

  return {
    text: item.str || '',
    direction: item.dir || 'ltr',
    baseline: y,
    transform: [...item.transform],
    boundingBox,
    font: {
      size: Math.hypot(scaleX, skewY),
      family: style?.fontFamily || '',
      weight: style?.fontWeight || '',
      style: style?.fontStyle || '',
      name: item.fontName || ''
    },
    source: { pageNumber, objectIndex, originalText: item.str || '' }
  };
}

export { combineBoundingBoxes };
