import { describe, expect, test } from 'vitest';
import { csvCell, exportFileName, slugify, toAnkiTsv, toCsv } from '../src/lib/exportSet.js';
import {
  MAX_FRAGMENT_CHARS,
  decodeShareFragment,
  encodeShareFragment,
  fromBase64Url,
  isShareFragment,
  toBase64Url,
} from '../src/lib/share.js';

const set = {
  title: 'Cell biology: the basics',
  summary: 'Cells.',
  flashcards: [
    {
      id: 'c-1',
      front: 'What is ATP?',
      back: 'The "energy" currency\nof the cell.',
      hint: 'Not DNA',
      source: 'ATP is…',
      grounded: true,
    },
    { id: 'c-2', front: '=1+1', back: 'Two, <b>not</b> a formula', hint: '' },
  ],
  quiz: [
    {
      id: 'q-1',
      type: 'mcq',
      question: 'Where is the Calvin cycle?',
      options: ['Stroma', 'Thylakoid'],
      answerIndex: 0,
      explanation: 'In the stroma.',
    },
    {
      id: 'q-2',
      type: 'truefalse',
      question: 'Leaves reflect green.',
      options: ['True', 'False'],
      answerIndex: 0,
      explanation: '',
    },
    {
      id: 'q-3',
      type: 'blank',
      question: 'ATP is adenosine _____.',
      answer: 'triphosphate',
      accepted: ['tri-phosphate'],
      explanation: '',
    },
  ],
};

describe('Anki export', () => {
  const text = toAnkiTsv(set);
  const lines = text.trimEnd().split('\n');

  test('starts with the headers Anki reads to map columns', () => {
    expect(lines.slice(0, 4)).toEqual(['#separator:tab', '#html:true', '#columns:Front\tBack\tTags', '#tags column:3']);
  });

  test('has one row per card and per question, three columns each', () => {
    const rows = lines.slice(4);
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.split('\t')).toHaveLength(3);
  });

  test('escapes HTML and turns newlines into <br> so a row never breaks', () => {
    const [first, second] = lines.slice(4);
    expect(first).toContain('The &quot;energy&quot; currency<br>of the cell.');
    expect(first).toContain('<small>Hint: Not DNA</small>');
    expect(second).toContain('Two, &lt;b&gt;not&lt;/b&gt; a formula');
  });

  test('quiz questions carry their options on the front and the answer on the back', () => {
    const [front, back, tags] = lines[6].split('\t');
    expect(front).toBe('Where is the Calvin cycle?<ol type="A"><li>Stroma</li><li>Thylakoid</li></ol>');
    expect(back).toBe('Stroma<br><br>In the stroma.');
    expect(tags).toBe('cell-biology-the-basics quiz');
    expect(lines[8].split('\t')[1]).toBe('triphosphate');
  });
});

describe('CSV export', () => {
  const text = toCsv(set);

  test('has a BOM, a header and CRLF rows', () => {
    expect(text.startsWith('\uFEFFkind,front,back,options,explanation,source\r\n')).toBe(true);
    expect(text.trimEnd().split('\r\n')).toHaveLength(1 + 5);
  });

  test('quotes cells with commas, quotes and newlines', () => {
    expect(text).toContain('"The ""energy"" currency\nof the cell."');
  });

  test('neutralises cells that a spreadsheet would run as formulas', () => {
    expect(text).toContain(",'=1+1,");
    expect(csvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('plain')).toBe('plain');
  });

  test('describes each quiz type in a readable way', () => {
    expect(text).toContain('mcq,Where is the Calvin cycle?,Stroma,Stroma | Thylakoid,In the stroma.,');
    expect(text).toContain('blank,ATP is adenosine _____.,triphosphate,tri-phosphate,,');
  });
});

describe('file names', () => {
  test('come from the title', () => {
    expect(exportFileName(set, 'csv')).toBe('cell-biology-the-basics.csv');
    expect(exportFileName({ title: '???' }, 'txt')).toBe('study-set.txt');
    expect(slugify('Café Über')).toBe('cafe-uber');
  });
});

describe('share links', () => {
  test('round-trip a set through a compressed fragment', async () => {
    const fragment = await encodeShareFragment(set);
    expect(fragment).toMatch(/^set=d\.[A-Za-z0-9_-]+$/);
    expect(isShareFragment(`#${fragment}`)).toBe(true);

    const result = await decodeShareFragment(`#${fragment}`);
    expect(result.ok).toBe(true);
    expect(result.studySet.flashcards.map((c) => c.front)).toEqual(['What is ATP?', '=1+1']);
    expect(result.studySet.quiz[2]).toMatchObject({ type: 'blank', answer: 'triphosphate' });
  });

  test('compress well enough for a URL', async () => {
    const fragment = await encodeShareFragment(set);
    expect(fragment.length).toBeLessThan(JSON.stringify(set).length);
  });

  test('never carry the sender’s grounded verdicts', async () => {
    const { studySet } = await decodeShareFragment(await encodeShareFragment(set));
    expect('grounded' in studySet.flashcards[0]).toBe(false);
    expect(studySet.flashcards[0].source).toBe('ATP is…');
  });

  test('strip a grounded flag smuggled into a hand-made link', async () => {
    const payload = {
      v: 1,
      title: 't',
      summary: '',
      flashcards: [{ id: 'c', front: 'f', back: 'b', grounded: true }],
      quiz: [],
    };
    const fragment = `set=j.${toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))}`;
    const { studySet } = await decodeShareFragment(fragment);
    expect('grounded' in studySet.flashcards[0]).toBe(false);
  });

  test('reject damaged, invalid, oversized and foreign links with a reason', async () => {
    const valid = await encodeShareFragment(set);
    const json = (value) => `set=j.${toBase64Url(new TextEncoder().encode(JSON.stringify(value)))}`;
    const cases = [
      ['#about', /isn’t a study-set link/],
      [`#${valid.slice(0, 40)}`, /damaged/],
      ['#set=d.!!!', /damaged/],
      ['#set=x.abcd', /newer version/],
      [json({ v: 1, title: 't', flashcards: 'nope', quiz: [] }), /usable study set/],
      [json({ v: 2, title: 't', flashcards: [], quiz: [] }), /usable study set/],
      [
        json({
          v: 1,
          title: 't',
          flashcards: Array.from({ length: 41 }, (_, i) => ({ id: `c${i}`, front: `${i}`, back: 'b' })),
          quiz: [],
        }),
        /usable study set/,
      ],
      [`#set=j.${'A'.repeat(MAX_FRAGMENT_CHARS)}`, /too long/],
    ];
    for (const [hash, reason] of cases) {
      const result = await decodeShareFragment(hash);
      expect(result.ok, hash.slice(0, 30)).toBe(false);
      expect(result.reason).toMatch(reason);
    }
  });

  test('base64url round-trips arbitrary bytes', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
    expect(() => fromBase64Url('not/valid+')).toThrow();
  });
});

describe('share links from elsewhere', () => {
  test('get unique, well-formed ids even if the link had none', async () => {
    const payload = {
      v: 1,
      title: 't',
      summary: '',
      flashcards: [
        { front: 'A', back: 'a' },
        { id: 'dup', front: 'B', back: 'b' },
        { id: 'dup', front: 'C', back: 'c' },
        { id: 'bad id!', front: 'D', back: 'd' },
      ],
      quiz: [],
    };
    const fragment = `set=j.${toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))}`;
    const { studySet } = await decodeShareFragment(fragment);
    const ids = studySet.flashcards.map((c) => c.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[1]).toBe('dup');
    expect(ids.every((id) => /^[A-Za-z0-9_-]+$/.test(id))).toBe(true);
  });
});
