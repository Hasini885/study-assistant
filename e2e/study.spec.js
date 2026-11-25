import { expect, test } from '@playwright/test';
import { eventStream, makeDocx, makePdf, studySet } from './fixtures.js';

const NOTES =
  'ATP is the energy currency of the cell. Cells make most of their ATP in the mitochondria through cellular respiration.';

/** Collects CSP violations and uncaught errors, so a test can assert there were none. */
function watchForErrors(page) {
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/i.test(message.text())) {
      problems.push(message.text());
    }
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

/** Mocked on the browser context, so every tab (a share link opened in a new one) gets it. */
async function mockApi(page) {
  await page
    .context()
    .route('**/api/health', (route) => route.fulfill({ json: { ok: true, configured: true, model: 'mock' } }));
  await page
    .context()
    .route('**/api/study-set', (route) =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: eventStream(studySet) })
    );
}

async function generate(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start studying' }).click();
  await page.getByLabel(/Paste your notes/).fill(NOTES);
  await page.getByRole('button', { name: 'Generate study set' }).click();
  await expect(page.getByRole('heading', { name: 'Cell energy' })).toBeVisible();
}

test('generate, flip, grade, quiz, save, and come back after a reload', async ({ page }) => {
  const problems = watchForErrors(page);
  await mockApi(page);

  await generate(page);
  await expect(page.getByText('4 of 5 items verified against your notes')).toBeVisible();

  // Flip and grade the first card.
  const deck = page.locator('.deck');
  await expect(deck.locator('.card__face--front .card__text')).toHaveText('What is ATP?');
  await page.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(deck.locator('.card__face--back')).toContainText('The energy currency of the cell.');
  await expect(deck.locator('.card__face--back')).toContainText('From your notes');
  await page.getByRole('button', { name: /^Good:/ }).click();
  await expect(deck.locator('.card__face--front .card__text')).toHaveText('Where is most ATP made?');

  // The quiz: one question of each type.
  await page.getByRole('tab', { name: /Quiz/ }).click();
  await page.getByRole('radio', { name: /ATP$/ }).click();
  await expect(page.getByText('Correct', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.getByRole('radio', { name: /False/ }).click();
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.getByLabel('Your answer').fill('triphosphate');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'See results' }).click();
  await expect(page.getByRole('heading', { name: '3 of 3 correct' })).toBeVisible();

  // Save, reload, reopen.
  await page.getByRole('button', { name: 'Save session' }).click();
  await expect(page.getByRole('button', { name: 'Saved ✓' })).toBeDisabled();

  await page.reload();
  // A returning visitor skips the landing page.
  await expect(page.getByRole('heading', { name: 'What are you studying?' })).toBeVisible();
  await page.getByRole('button', { name: /^Cell energy/ }).click();
  await expect(page.getByRole('button', { name: 'Saved ✓' })).toBeDisabled();
  // The graded card's progress survived the reload.
  await expect(page.locator('.statlist')).toContainText('Known 1');

  expect(problems).toEqual([]);
});

test('PDF and Word uploads are read in the browser under the production CSP', async ({ page }) => {
  const problems = watchForErrors(page);
  await mockApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start studying' }).click();

  const input = page.locator('input[type="file"]');
  const notes = page.getByLabel(/Paste your notes/);

  await input.setInputFiles({
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: makePdf('ATP is the energy currency of the cell.'),
  });
  await expect(page.getByText(/Extracted \d+ characters from/)).toContainText('notes.pdf');
  await expect(notes).toHaveValue(/ATP is the energy currency of the cell\./);

  await input.setInputFiles({
    name: 'notes.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: makeDocx('Mitochondria make most of the ATP.'),
  });
  await expect(page.getByText(/Extracted \d+ characters from/)).toContainText('notes.docx');
  await expect(notes).toHaveValue(/Mitochondria make most of the ATP\./);

  expect(problems).toEqual([]);
});

test('a share link opens the set in another tab', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockApi(page);
  await generate(page);

  await page.getByText('Share & export').click();
  await page.getByRole('button', { name: /Copy share link/ }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/#set=d\./);

  const other = await context.newPage();
  await other.goto(link);
  await expect(other.getByRole('heading', { name: 'Cell energy' })).toBeVisible();
  await expect(other.getByRole('button', { name: 'Start studying' })).toHaveCount(0);
});
