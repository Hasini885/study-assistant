import { useEffect, useRef, useState } from 'react';
import { downloadText, exportFileName, toAnkiTsv, toCsv } from '../lib/exportSet.js';
import { encodeShareFragment } from '../lib/share.js';

/**
 * "Share & export" for the set on screen: a copyable link, Anki and CSV
 * downloads, and printing. A <details> menu keeps this dependency-free and
 * keyboard-accessible without a popover library; it closes on Escape and on
 * a click outside.
 */
export function SetActions({ studySet }) {
  const menuRef = useRef(null);
  // { state: 'copied' | 'manual' | 'error', url? }
  const [share, setShare] = useState(null);

  useEffect(() => {
    const close = (event) => {
      const menu = menuRef.current;
      if (!menu?.open) return;
      if (event.type === 'keydown' ? event.key === 'Escape' : !menu.contains(event.target)) menu.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  // A new set means any copied link is for the old one.
  useEffect(() => setShare(null), [studySet]);

  const closeMenu = () => {
    if (menuRef.current) menuRef.current.open = false;
  };

  const copyLink = async () => {
    let url;
    try {
      url = `${window.location.origin}${window.location.pathname}#${await encodeShareFragment(studySet)}`;
    } catch {
      setShare({ state: 'error' });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShare({ state: 'copied', url });
    } catch {
      // Clipboard can be blocked (permissions, insecure origin): show the link instead.
      setShare({ state: 'manual', url });
    }
    closeMenu();
  };

  return (
    <div className="set-actions">
      <details className="menu" ref={menuRef}>
        <summary className="btn btn--small btn--ghost">Share &amp; export</summary>
        <div className="menu__panel" role="group" aria-label="Share and export">
          <button type="button" className="menu__item" onClick={copyLink}>
            Copy share link
            <span className="menu__note">The whole set, inside the link — nothing is uploaded</span>
          </button>
          <button
            type="button"
            className="menu__item"
            onClick={() => {
              downloadText(toAnkiTsv(studySet), exportFileName(studySet, 'txt'), 'text/plain;charset=utf-8');
              closeMenu();
            }}
          >
            Download for Anki
            <span className="menu__note">Import with File › Import in Anki</span>
          </button>
          <button
            type="button"
            className="menu__item"
            onClick={() => {
              downloadText(toCsv(studySet), exportFileName(studySet, 'csv'), 'text/csv;charset=utf-8');
              closeMenu();
            }}
          >
            Download CSV
            <span className="menu__note">For spreadsheets</span>
          </button>
          <button
            type="button"
            className="menu__item"
            onClick={() => {
              closeMenu();
              window.print();
            }}
          >
            Print
            <span className="menu__note">Every card and question, with answers</span>
          </button>
        </div>
      </details>

      <span className="set-actions__status" role="status">
        {share?.state === 'copied' && 'Link copied'}
        {share?.state === 'error' && 'Couldn’t make a link for this set'}
      </span>
      {share?.state === 'manual' && (
        <input
          className="set-actions__link"
          readOnly
          value={share.url}
          aria-label="Share link — copy it"
          onFocus={(event) => event.target.select()}
          autoFocus
        />
      )}
    </div>
  );
}
