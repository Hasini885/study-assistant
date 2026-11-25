import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import { STORAGE_KEY } from '../src/lib/sessionStore.js';
import { mockApi } from './fixtures/studySet.js';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(mockApi()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function generateSet(user) {
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Start studying' }));
  await user.type(screen.getByLabelText(/paste your notes/i), 'Cells');
  await user.click(screen.getByRole('button', { name: 'Generate study set' }));
  await screen.findByRole('heading', { name: 'Cell biology' });
}

describe('App', () => {
  test('grading a card schedules it and saving persists the progress', async () => {
    const user = userEvent.setup();
    await generateSet(user);

    await user.click(screen.getByRole('button', { name: 'Reveal answer' }));
    await user.click(screen.getByRole('button', { name: /^Good:/ }));

    await user.click(screen.getByRole('button', { name: 'Save session' }));
    expect(screen.getByRole('button', { name: 'Saved ✓' })).toBeDisabled();

    const [saved] = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    expect(saved.progress['c-atp']).toMatchObject({ status: 'known', srs: { reps: 1, interval: 1 } });
  });

  test('marks made after saving are persisted immediately', async () => {
    const user = userEvent.setup();
    await generateSet(user);
    await user.click(screen.getByRole('button', { name: 'Save session' }));

    await user.keyboard('2'); // Review later on the first card

    const [saved] = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    expect(saved.progress['c-atp']).toEqual({ status: 'review' });
  });

  test('a loaded session shows as saved', async () => {
    // Regression: loading a session set "saved", then an effect watching the
    // study set immediately reset it, so the button always read "Save session".
    const user = userEvent.setup();
    await generateSet(user);
    await user.click(screen.getByRole('button', { name: 'Save session' }));
    await user.click(screen.getByRole('button', { name: 'New set' }));

    const sessions = screen.getByRole('heading', { name: 'Saved sessions' }).closest('section');
    await user.click(within(sessions).getByRole('button', { name: /^Cell biology/ }));

    expect(await screen.findByRole('button', { name: 'Saved ✓' })).toBeDisabled();
  });

  test('the grade shortcuts only work once the answer is revealed', async () => {
    const user = userEvent.setup();
    await generateSet(user);
    await user.click(screen.getByRole('button', { name: 'Save session' }));

    await user.keyboard('g');
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY))[0].progress).toEqual({});

    await user.click(screen.getByRole('button', { name: 'Reveal answer' }));
    await user.keyboard('e');
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY))[0].progress['c-atp'].srs.interval).toBe(4);
  });
});
