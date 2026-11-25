import { describe, expect, test } from 'vitest';
import { FileTextError, MAX_FILE_BYTES, cleanExtractedText, extractTextFromFile, fileKind } from '../src/lib/extractText.js';

const file = (content, name, type = '') => new File([content], name, { type });

describe('fileKind', () => {
  test('recognises supported files by extension or MIME type', () => {
    expect(fileKind(file('', 'notes.PDF'))).toBe('pdf');
    expect(fileKind(file('', 'blob', 'application/pdf'))).toBe('pdf');
    expect(fileKind(file('', 'essay.docx'))).toBe('docx');
    expect(fileKind(file('', 'a.md'))).toBe('text');
    expect(fileKind(file('', 'a.txt'))).toBe('text');
    expect(fileKind(file('', 'x', 'text/plain'))).toBe('text');
    expect(fileKind(file('', 'old.doc'))).toBeNull();
    expect(fileKind(file('', 'pic.png', 'image/png'))).toBeNull();
  });
});

describe('cleanExtractedText', () => {
  test('normalises newlines, spaces and blank lines', () => {
    expect(cleanExtractedText('  a\r\nb  c\t\td\n\n\n\n e  ')).toBe('a\nb c d\n\ne');
  });

  test('rejoins words a PDF hyphenated across a line break', () => {
    expect(cleanExtractedText('photo-\nsynthesis')).toBe('photosynthesis');
    expect(cleanExtractedText('Calvin-\nCycle')).toBe('Calvin-\nCycle'); // capitalised: leave it
  });

  test('copes with nothing', () => {
    expect(cleanExtractedText(undefined)).toBe('');
  });
});

describe('extractTextFromFile', () => {
  test('reads text and markdown files directly', async () => {
    await expect(extractTextFromFile(file('# Notes\n\nATP is energy.', 'n.md'))).resolves.toEqual({
      text: '# Notes\n\nATP is energy.',
      kind: 'text',
    });
  });

  test('uses the PDF and Word parsers for those files', async () => {
    const parsers = { pdf: async () => 'from pdf', docx: async () => 'from  docx' };
    await expect(extractTextFromFile(file('x', 'a.pdf'), parsers)).resolves.toEqual({ text: 'from pdf', kind: 'pdf' });
    await expect(extractTextFromFile(file('x', 'a.docx'), parsers)).resolves.toEqual({ text: 'from docx', kind: 'docx' });
  });

  test('rejects unsupported types with a helpful message', async () => {
    await expect(extractTextFromFile(file('x', 'slides.pptx'))).rejects.toMatchObject({
      code: 'unsupported',
      message: expect.stringMatching(/PDF, Word/),
    });
  });

  test('rejects oversized files before reading them', async () => {
    const big = file('x', 'huge.pdf');
    Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 });
    let parsed = false;
    await expect(extractTextFromFile(big, { pdf: async () => ((parsed = true), 'x') })).rejects.toMatchObject({
      code: 'too_big',
    });
    expect(parsed).toBe(false);
  });

  test('explains a PDF with no text layer', async () => {
    await expect(extractTextFromFile(file('x', 'scan.pdf'), { pdf: async () => '  \n ' })).rejects.toMatchObject({
      code: 'empty',
      message: expect.stringMatching(/scanned image/),
    });
  });

  test('turns parser crashes into a readable error', async () => {
    const error = await extractTextFromFile(file('x', 'locked.pdf'), {
      pdf: async () => {
        throw new Error('PasswordException');
      },
    }).catch((e) => e);
    expect(error).toBeInstanceOf(FileTextError);
    expect(error.code).toBe('unreadable');
  });
});
