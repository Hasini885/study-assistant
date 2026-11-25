import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import { INTRO_KEY } from '../src/lib/intro.js';
import { encodeShareFragment } from '../src/lib/share.js';
import { mockApi, studySet } from './fixtures/studySet.js';

beforeEach(() => vi.stubGlobal('fetch', vi.fn(mockApi())));
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('landing page', () => {
  test('first visit shows the landing page; entering remembers it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Start studying' }));
    expect(window.localStorage.getItem(INTRO_KEY)).toBe('1');
  });

  test('returning visitors skip it, and can replay it', async () => {
    window.localStorage.setItem(INTRO_KEY, '1');
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole('button', { name: 'Start studying' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What are you studying?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replay intro' }));
    expect(screen.getByRole('button', { name: 'Start studying' })).toBeInTheDocument();
  });
});

describe('share links', () => {
  test('a shared set opens directly, without the landing page', async () => {
    window.history.replaceState(null, '', `/#${await encodeShareFragment(studySet)}`);
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Cell biology' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start studying' })).not.toBeInTheDocument();
    expect(window.location.hash).toBe(''); // a reload won't re-import over later work
    expect(screen.getByRole('button', { name: 'Save session' })).toBeEnabled();
  });

  test('a broken link explains what went wrong', async () => {
    window.history.replaceState(null, '', '/#set=d.broken');
    render(<App />);
    expect(await screen.findByText('Couldn’t open that link')).toBeInTheDocument();
    expect(screen.getByText(/damaged/)).toBeInTheDocument();
  });
});
