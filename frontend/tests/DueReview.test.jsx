import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import { STORAGE_KEY, gradeRecord } from '../src/lib/sessionStore.js';
import { mockApi, studySet } from './fixtures/studySet.js';

const DAY = 86_400_000;

function seed() {
  const yesterday = Date.now() - 2 * DAY;
  const progress = {
    'c-atp': gradeRecord(undefined, 'good', yesterday), // due a day ago
    'c-dna': gradeRecord(undefined, 'easy', Date.now()), // due in four days
  };
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([{ id: 's-1', title: 'Cell biology', savedAt: yesterday, counts: {}, studySet, meta: null, progress }])
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(mockApi()));
  seed();
});

afterEach(() => vi.unstubAllGlobals());

describe('Due today', () => {
  test('the landing page offers the due cards and the review clears them', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Review 1 due card' }));
    expect(screen.getByRole('region', { name: 'Cards due today' })).toBeInTheDocument();
    expect(screen.getByText('What is ATP?', { selector: '.card__text' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal answer' }));
    await user.click(screen.getByRole('button', { name: /^Good:/ }));

    expect(screen.getByRole('heading', { name: 'All caught up' })).toBeInTheDocument();
    const [saved] = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    expect(saved.progress['c-atp'].srs.reps).toBe(2);
    expect(saved.progress['c-atp'].srs.due).toBeGreaterThan(Date.now());
  });

  test('a card answered Again comes round once more before the review ends', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Review 1 due card' }));

    await user.click(screen.getByRole('button', { name: 'Reveal answer' }));
    await user.keyboard('a');
    expect(screen.getByText('1 left', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'All caught up' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal answer' }));
    await user.keyboard('g');
    expect(screen.getByRole('heading', { name: 'All caught up' })).toBeInTheDocument();
  });

  test('the sidebar shows the due count across sessions', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Start studying' }));

    const panel = screen.getByRole('heading', { name: 'Due today' }).closest('section');
    expect(panel).toHaveTextContent('1card to review');
    expect(screen.getByText('1 due today')).toBeInTheDocument();
  });
});
