import { crc32 } from 'node:zlib';

/** The study set the mocked API returns. */
export const studySet = {
  title: 'Cell energy',
  summary: 'How cells store and spend energy.',
  flashcards: [
    {
      id: 'c-atp',
      front: 'What is ATP?',
      back: 'The energy currency of the cell.',
      hint: '',
      source: 'ATP is the energy currency of the cell',
      grounded: true,
    },
    {
      id: 'c-mito',
      front: 'Where is most ATP made?',
      back: 'In the mitochondria.',
      hint: '',
      source: 'invented',
      grounded: false,
    },
  ],
  quiz: [
    {
      id: 'q-1',
      type: 'mcq',
      question: 'Which molecule stores energy for the cell?',
      options: ['ATP', 'DNA', 'RNA', 'Glucose-6-phosphate'],
      answerIndex: 0,
      explanation: 'ATP is the energy currency.',
    },
    {
      id: 'q-2',
      type: 'truefalse',
      question: 'Most ATP is made in the nucleus.',
      options: ['True', 'False'],
      answerIndex: 1,
      explanation: 'It is made in the mitochondria.',
    },
    {
      id: 'q-3',
      type: 'blank',
      question: 'ATP stands for adenosine _____.',
      answer: 'triphosphate',
      accepted: [],
      explanation: '',
    },
  ],
};

/** An SSE body, as the server streams it: a partial, then the finished set. */
export function eventStream(set) {
  const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  return [
    event('partial', { studySet: { ...set, flashcards: set.flashcards.slice(0, 1), quiz: [] } }),
    event('done', {
      studySet: set,
      meta: { repairs: [], attempts: 1, model: 'mock', grounding: { checked: 5, verified: 4 } },
    }),
  ].join('');
}

/** A one-page PDF whose text layer contains `text`. Built by hand, xref and all. */
export function makePdf(text) {
  const escaped = text.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = `BT /F1 16 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** A minimal .docx (a stored, uncompressed zip) with one paragraph of `text`. */
export function makeDocx(text) {
  const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return zip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${xml(text)}</w:t></w:r></w:p></w:body></w:document>`,
  });
}

/** Writes a zip with every entry stored (no compression), which is all .docx needs. */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
