import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'study-assistant:theme';
const ORDER = ['system', 'light', 'dark'];

/** Theme preference, persisted, defaulting to whatever the OS is set to. */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return ORDER.includes(saved) ? saved : 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', resolved === 'dark' ? '#0b0d12' : '#f7f8fa');
    };

    apply();
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* preference just won't persist */
    }

    if (theme !== 'system') return undefined;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme((current) => ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]);
  }, []);

  return { theme, cycleTheme };
}
