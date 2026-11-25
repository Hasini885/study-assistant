/** A small, valid study set as the API returns it. */
export const studySet = {
  title: 'Cell biology',
  summary: 'The basics of cells.',
  flashcards: [
    { id: 'c-atp', front: 'What is ATP?', back: 'The energy currency of the cell.', hint: '' },
    { id: 'c-dna', front: 'What is DNA?', back: 'The molecule that carries genes.', hint: '' },
  ],
  quiz: [
    {
      id: 'q-stroma',
      question: 'Where does the Calvin cycle occur?',
      options: ['Stroma', 'Thylakoid', 'Cytosol', 'Nucleus'],
      answerIndex: 0,
      explanation: 'It happens in the stroma.',
    },
  ],
};

/** Routes fetch calls to canned API responses. */
export function mockApi(routes = {}) {
  return async (url, init) => {
    const path = String(url);
    const handler = routes[path];
    if (handler) return handler(init);
    if (path === '/api/health') return json({ ok: true, configured: true, model: 'test-model' });
    if (path === '/api/study-set') return json({ studySet, meta: { repairs: [] } });
    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  };
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
