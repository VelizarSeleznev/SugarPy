import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './styles.css';
import 'katex/dist/katex.min.css';

const rootEl = document.getElementById('root') as HTMLElement;
const errorBucket: string[] = (window as any).__sugarpy_errors || [];
(window as any).__sugarpy_errors = errorBucket;

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = args.map(String).join(' ');
  errorBucket.push(msg);
  origConsoleError(...args);
};

function renderFatal(message: string) {
  errorBucket.push(message);
  rootEl.innerHTML = `
    <div style="padding:24px;font-family:Work Sans, sans-serif;color:#1b1b1b">
      <h1 style="font-family:Newsreader, serif;">SugarPy failed to load</h1>
      <p>Open DevTools console and send this error:</p>
      <pre style="background:#f6f1e9;padding:12px;border-radius:8px;white-space:pre-wrap;">${message}</pre>
    </div>
  `;
}

window.addEventListener('error', (event) => {
  renderFatal(event.error?.message || event.message || 'Unknown error');
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
  renderFatal(reason);
});

try {
  const root = createRoot(rootEl);
  root.render(<App />);
} catch (err) {
  renderFatal(err instanceof Error ? err.message : String(err));
}
