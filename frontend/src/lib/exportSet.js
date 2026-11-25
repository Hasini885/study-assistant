import { correctAnswerText, quizType } from '@contract/quiz.js';

/**
 * Exports a study set for other tools.
 *
 *   Anki    a tab-separated text file with Anki's file headers, so File ›
 *           Import maps the columns with no setup. Quiz questions become
 *           cards too: the question and its options on the front, the answer
 *           and explanation on the back.
 *   CSV     one row per flashcard and per question, for spreadsheets.
 *
 * Pure functions returning text; `downloadText` does the browser part.
 */

/** Anki import format: https://docs.ankiweb.net/importing/text-files.html */
export function toAnkiTsv(studySet) {
  const tag = slugify(studySet.title) || 'study-set';
  const rows = [
    ...studySet.flashcards.map((card) => [
      html(card.front) + (card.hint ? `<br><small>Hint: ${html(card.hint)}</small>` : ''),
      html(card.back),
      tag,
    ]),
    ...studySet.quiz.map((q) => {
      const type = quizType(q);
      const options = type === 'blank' ? '' : `<ol type="A">${q.options.map((o) => `<li>${html(o)}</li>`).join('')}</ol>`;
      const back = html(correctAnswerText(q)) + (q.explanation ? `<br><br>${html(q.explanation)}` : '');
      return [html(q.question) + options, back, `${tag} quiz`];
    }),
  ];

  const header = ['#separator:tab', '#html:true', '#columns:Front\tBack\tTags', '#tags column:3'];
  return `${[...header, ...rows.map((row) => row.join('\t'))].join('\n')}\n`;
}

const CSV_COLUMNS = ['kind', 'front', 'back', 'options', 'explanation', 'source'];

/** RFC 4180 CSV, with a BOM so Excel reads it as UTF-8. */
export function toCsv(studySet) {
  const rows = [
    CSV_COLUMNS,
    ...studySet.flashcards.map((card) => ['flashcard', card.front, card.back, '', card.hint ?? '', card.source ?? '']),
    ...studySet.quiz.map((q) => [
      quizType(q),
      q.question,
      correctAnswerText(q),
      quizType(q) === 'blank' ? (q.accepted ?? []).join(' | ') : q.options.join(' | '),
      q.explanation ?? '',
      q.source ?? '',
    ]),
  ];
  return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/**
 * Quotes a cell when needed, and defuses spreadsheet formulas: a card that
 * starts with "=" is text from a model, and must not run when opened in Excel.
 */
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A file name from the set's title: "Cell biology" → "cell-biology". */
export function exportFileName(studySet, extension) {
  return `${slugify(studySet.title) || 'study-set'}.${extension}`;
}

export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Escapes text for Anki's HTML fields; a tab or newline would break the row. */
function html(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, '<br>');
}

/** Saves text as a file via a temporary object URL. */
export function downloadText(text, fileName, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
