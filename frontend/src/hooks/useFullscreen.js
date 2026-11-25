import { useCallback, useEffect, useState } from 'react';

/**
 * Native fullscreen, for distraction-free studying.
 *
 * `supported` is reported separately because iOS Safari exposes the Fullscreen
 * API on video elements only — hiding the button there beats showing one that
 * silently does nothing. State is read from the document rather than tracked
 * locally, so pressing Esc (which we never see as a click) still keeps the
 * button label honest.
 */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const supported =
    typeof document !== 'undefined' && Boolean(document.fullscreenEnabled ?? document.webkitFullscreenEnabled);

  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement ?? document.webkitFullscreenElement));
    sync();
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement ?? document.webkitFullscreenElement) {
        await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
      } else {
        const el = document.documentElement;
        await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
      }
    } catch {
      // Browsers reject this outside a user gesture, or when a permissions
      // policy forbids it. Nothing useful to say — the button just won't take.
    }
  }, []);

  return { isFullscreen, toggle, supported };
}
