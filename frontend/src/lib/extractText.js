/**
 * Turns an uploaded file into plain text, entirely in the browser.
 *
 * The file never leaves the device — only the extracted text is sent, through
 * the same /api/study-set request as pasted notes, under the same input cap.
 *
 * The PDF and Word parsers are large, so each is imported on first use:
 * someone who only ever pastes text never downloads them.
 */

export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown'];
export const ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_EXTENSIONS,
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
].join(',');

/** Past this, a file is almost certainly not lecture notes, and parsing it would stall the tab. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** An extraction failure we can explain to the user. */
export class FileTextError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FileTextError';
    this.code = code;
  }
}

/** 'pdf' | 'docx' | 'text' | null */
export function fileKind(file) {
  const name = String(file?.name ?? '').toLowerCase();
  const type = String(file?.type ?? '').toLowerCase();
  if (name.endsWith('.pdf') || type === 'application/pdf') return 'pdf';
  if (name.endsWith('.docx') || type.includes('wordprocessingml')) return 'docx';
  if (/\.(txt|md|markdown)$/.test(name) || type.startsWith('text/')) return 'text';
  return null;
}

/**
 * @param {File} file
 * @param {object} [parsers] injectable for tests
 * @returns {Promise<{text: string, kind: string}>}
 */
export async function extractTextFromFile(file, parsers = {}) {
  const kind = fileKind(file);
  if (!kind) {
    throw new FileTextError(
      'unsupported',
      `${file?.name || 'That file'} isn’t a supported type. Upload a PDF, Word (.docx), .txt or .md file.`
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new FileTextError(
      'too_big',
      `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`
    );
  }

  let raw;
  try {
    if (kind === 'text') raw = await readBlob(file, 'text');
    else if (kind === 'pdf') raw = await (parsers.pdf ?? readPdf)(await readBlob(file, 'arrayBuffer'));
    else raw = await (parsers.docx ?? readDocx)(await readBlob(file, 'arrayBuffer'));
  } catch (error) {
    if (error instanceof FileTextError) throw error;
    throw new FileTextError('unreadable', `Couldn’t read ${file.name}. It may be damaged or password-protected.`);
  }

  const text = cleanExtractedText(raw);
  if (!text) {
    throw new FileTextError(
      'empty',
      kind === 'pdf'
        ? `No text found in ${file.name}. It may be a scanned image — paste the text instead.`
        : `${file.name} has no text in it.`
    );
  }
  return { text, kind };
}

/**
 * Tidies text pulled out of a document: unified newlines, no runs of spaces,
 * at most one blank line in a row, and words that a PDF hyphenated across a
 * line break joined back together.
 */
export function cleanExtractedText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/([a-z])-\n([a-z])/g, '$1$2')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Blob.text() / arrayBuffer(), with a FileReader fallback for older Safari. */
function readBlob(blob, as) {
  if (typeof blob[as] === 'function') return blob[as]();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    if (as === 'text') reader.readAsText(blob);
    else reader.readAsArrayBuffer(blob);
  });
}

async function readPdf(buffer) {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ''}`).join(''));
    page.cleanup();
  }
  await pdf.destroy();
  return pages.join('\n\n');
}

async function readDocx(buffer) {
  const mammoth = await import('mammoth/mammoth.browser.js');
  const { value } = await (mammoth.default ?? mammoth).extractRawText({ arrayBuffer: buffer });
  return value;
}
