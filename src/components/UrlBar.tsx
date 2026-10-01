/**
 * UrlBar: the flagship entry point. The student types a URL, presses
 * Enter (or clicks Go), and the whole DNS → ARP → routing → TCP → HTTP
 * → teardown journey is scripted and ready to play/pause. Pure UI over
 * the store's openUrl action.
 */

import { useState } from 'react';
import { useApp } from '../state/store';

export function UrlBar() {
  const openUrl = useApp((s) => s.openUrl);
  const lab = useApp((s) => s.lab);
  const isFlagship = lab?.id === 'open-web-page';
  const [value, setValue] = useState('http://example.local/index.html');
  const [error, setError] = useState(false);

  const go = (): void => {
    if (parseHttpUrlLoose(value) === undefined) {
      setError(true);
      return;
    }
    setError(false);
    openUrl(value);
    // Auto-run so the journey starts immediately; pause is one click away.
    useApp.getState().run();
  };

  return (
    <section className="url-bar" aria-label="Open a web page">
      <input
        type="text"
        value={value}
        aria-label="URL to open"
        onChange={(e) => {
          setValue(e.target.value);
          setError(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go();
        }}
      />
      <button className="btn primary" onClick={go}>
        Go
      </button>
      {error && <span className="url-error">Enter an http:// URL</span>}
      {isFlagship && !error && <span className="muted url-hint">Enter runs the full journey — pause anytime.</span>}
      {!isFlagship && <span className="muted url-hint">Go switches to the “Open a Web Page” journey.</span>}
    </section>
  );
}

function parseHttpUrlLoose(url: string): { host: string; path: string } | undefined {
  const match = /^https?:\/\/([^/\s]+)(\/\S*)?$/.exec(url.trim());
  if (match === null) return undefined;
  return { host: match[1] ?? '', path: match[2] ?? '/' };
}
