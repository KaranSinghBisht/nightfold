import { useEffect, useState } from 'react';
import { Landing } from './Landing';
import { Table } from './Table';

/**
 * Two pages, one bundle. Hash routing rather than history routing so the demo
 * works from any host — a static preview, a file:// open, or Vercel — without
 * needing a rewrite rule to exist.
 */
function currentRoute(): 'landing' | 'play' {
  const page = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return page === 'play' ? 'play' : 'landing';
}

export default function App() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (route === 'play') return <Table />;
  return <Landing onPlay={() => { window.location.hash = '#play'; }} />;
}
