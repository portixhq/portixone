import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody } from '../protocol/protocol.adapter.js';
import type { ConfigService } from '../config/config.service.js';

export function handleDashboard(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(DASHBOARD_HTML);
}

export async function handleSetDefaultPrinter(
  req: IncomingMessage,
  res: ServerResponse,
  configService: ConfigService,
): Promise<void> {
  const payload = await readJsonBody<{ printerName?: string }>(req);
  const printerName = payload?.printerName;
  if (!printerName || typeof printerName !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'INVALID_REQUEST', message: '"printerName" is required' }));
    return;
  }
  configService.setDefaultPrinter(printerName);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ defaultPrinter: printerName }));
}

// A single self-contained page (no separate JS/CSS files to stage or serve)
// — this is the local setup/status surface tracked as Fase 3/5's "welcome
// window" + "local dashboard" in ROADMAP.md, deliberately unstyled beyond
// basics since real visual identity is Fase 7, not yet built.
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PortixOne Runtime</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #8884; padding-bottom: 0.4rem; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.6rem 0; border-bottom: 1px solid #8882; }
  .dot { display: inline-block; width: 0.6rem; height: 0.6rem; border-radius: 50%; margin-right: 0.5rem; }
  .dot.online { background: #2ea043; }
  .dot.offline { background: #999; }
  .muted { opacity: 0.65; font-size: 0.9em; }
  button { cursor: pointer; padding: 0.4rem 0.9rem; border-radius: 6px; border: 1px solid #8886; background: transparent; color: inherit; }
  button:disabled { opacity: 0.4; cursor: default; }
  button.primary { background: #2f6fed; border-color: #2f6fed; color: white; }
  #printTestResult, #statusLine { margin-top: 0.75rem; }
  #jobs td, #jobs th { text-align: left; padding: 0.3rem 0.6rem 0.3rem 0; font-size: 0.9em; }
</style>
</head>
<body>
  <h1>PortixOne</h1>
  <div id="statusLine">Checking runtime status…</div>

  <h2>Printers</h2>
  <div id="printerList"><p class="muted">Loading…</p></div>

  <h2>Test print</h2>
  <p class="muted">Sends a short test receipt to your default printer.</p>
  <button id="printTestBtn" class="primary" disabled>Print test ticket</button>
  <div id="printTestResult"></div>

  <h2>Recent jobs</h2>
  <div id="jobsList"><p class="muted">Loading…</p></div>

<script>
const apiKey = new URLSearchParams(location.search).get('key') || '';

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-portix-api-key': apiKey, ...(options && options.headers) },
  });
  const body = await res.json().catch(() => undefined);
  if (!res.ok) throw new Error((body && body.message) || (res.status + ' ' + res.statusText));
  return body;
}

let defaultPrinter;

async function refreshStatus() {
  try {
    const health = await api('/health');
    defaultPrinter = health.defaultPrinter;
    document.getElementById('statusLine').innerHTML =
      '<span class="dot online"></span>Runtime online (v' + health.version + ')' +
      (defaultPrinter ? ' — default printer: <strong>' + defaultPrinter + '</strong>' : ' — no default printer set yet');
    document.getElementById('printTestBtn').disabled = !defaultPrinter;
  } catch {
    document.getElementById('statusLine').innerHTML = '<span class="dot offline"></span>Runtime offline';
  }
}

async function refreshPrinters() {
  const el = document.getElementById('printerList');
  try {
    const printers = await api('/printers');
    if (printers.length === 0) {
      el.innerHTML = '<p class="muted">No printers detected.</p>';
      return;
    }
    el.innerHTML = '';
    for (const printer of printers) {
      const row = document.createElement('div');
      row.className = 'row';
      const isDefault = printer.name === defaultPrinter;
      row.innerHTML =
        '<span><span class="dot ' + (printer.online ? 'online' : 'offline') + '"></span>' + printer.name +
        (printer.status ? ' <span class="muted">— ' + printer.status + '</span>' : '') + '</span>';
      const btn = document.createElement('button');
      btn.textContent = isDefault ? 'Default' : 'Set as default';
      btn.disabled = isDefault;
      btn.onclick = async () => {
        btn.disabled = true;
        await api('/config/default-printer', { method: 'POST', body: JSON.stringify({ printerName: printer.name }) });
        await refreshStatus();
        await refreshPrinters();
      };
      row.appendChild(btn);
      el.appendChild(row);
    }
  } catch (error) {
    el.innerHTML = '<p class="muted">Could not load printers: ' + error.message + '</p>';
  }
}

async function refreshJobs() {
  const el = document.getElementById('jobsList');
  try {
    const jobs = await api('/jobs');
    if (jobs.length === 0) {
      el.innerHTML = '<p class="muted">No print jobs yet.</p>';
      return;
    }
    const recent = jobs.slice(-5).reverse();
    el.innerHTML =
      '<table id="jobs"><tr><th>Status</th><th>Printer</th><th>Created</th></tr>' +
      recent.map((j) => '<tr><td>' + j.status + '</td><td>' + (j.printerName || 'default') + '</td><td>' + new Date(j.createdAt).toLocaleTimeString() + '</td></tr>').join('') +
      '</table>';
  } catch (error) {
    el.innerHTML = '<p class="muted">Could not load jobs: ' + error.message + '</p>';
  }
}

document.getElementById('printTestBtn').onclick = async () => {
  const btn = document.getElementById('printTestBtn');
  const resultEl = document.getElementById('printTestResult');
  btn.disabled = true;
  resultEl.textContent = 'Printing…';
  try {
    const result = await api('/print', { method: 'POST', body: JSON.stringify({ content: 'PortixOne test ticket\\n\\nIf you can read this, printing works!' }) });
    resultEl.textContent = 'Sent — job ' + result.jobId + ' (' + result.status + ')';
    await refreshJobs();
  } catch (error) {
    resultEl.textContent = 'Failed: ' + error.message;
  } finally {
    btn.disabled = !defaultPrinter;
  }
};

refreshStatus().then(refreshPrinters);
refreshJobs();
</script>
</body>
</html>
`;
