'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * Renders mermaid source. Mermaid is ~500KB and touches the DOM, so it is
 * imported lazily on first render rather than bundled into every page.
 */
export default function Diagram({ source, className = '' }: { source: string; className?: string }) {
  const id = useId().replace(/:/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!source.trim()) return;

    (async () => {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'strict',
        themeVariables: {
          background: '#14161d',
          primaryColor: '#1c2029',
          primaryTextColor: '#e8e9ed',
          primaryBorderColor: '#2b4438',
          lineColor: '#8b90a0',
          fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
        },
      });
      try {
        const { svg } = await mermaid.render(`d${id}`, source);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'diagram failed to render');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, id]);

  if (error) {
    return (
      <pre className={`overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-xs text-muted ${className}`}>
        {source}
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      className={`overflow-x-auto rounded-lg border border-border bg-surface p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full ${className}`}
    />
  );
}
