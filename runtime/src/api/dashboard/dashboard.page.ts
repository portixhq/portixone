import { APPLICATIONS_HTML, APPLICATIONS_SCRIPT } from './applications.section.js';
import { DASHBOARD_STYLES } from './dashboard.styles.js';
import { OVERVIEW_HTML, OVERVIEW_SCRIPT } from './overview.section.js';
import { TARGETS_HTML, TARGETS_SCRIPT } from './targets.section.js';

/**
 * The Runtime Control Center.
 *
 * One self-contained document, composed from sections that each own their markup and behaviour.
 * There is no build step and there shouldn't be: the Runtime ships as plain compiled JS, and a
 * bundler for a local page would cost more than it returns.
 *
 * Screens are limited to the three the Runtime can actually answer for — Overview, Applications and
 * Printer Targets. Events, Settings and About are designed but not built: nothing records events,
 * no setting is persisted, and shipping those screens now would mean rendering empty shells or
 * inventing data. An interface that reassures without evidence is worse than one that is missing.
 */
export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Portix Runtime</title>
<style>${DASHBOARD_STYLES}</style>
</head>
<body>
<div class="shell">
  <aside class="side">
    <div class="brand-mark"><div class="name">Portix Runtime</div></div>
    <nav class="nav">
      <a data-screen="overview" class="active">Overview</a>
      <a data-screen="applications">Applications</a>
      <a data-screen="targets">Printer targets</a>
    </nav>
    <div class="side-foot">
      Local service<br />
      <span class="mono" id="footVersion">—</span>
    </div>
  </aside>

  <div class="main">
    <div class="content">
${OVERVIEW_HTML}
${APPLICATIONS_HTML}
${TARGETS_HTML}
    </div>

    <div class="statusbar">
      <div class="sb"><span class="sb-dot" id="sbDot"></span><span class="sb-k">Runtime</span><span class="sb-v" id="sbRuntime">—</span></div>
      <div class="sb"><span class="sb-k">Applications</span><span class="sb-v" id="sbApps">—</span></div>
      <div class="sb"><span class="sb-k">Targets</span><span class="sb-v" id="sbTargets">—</span></div>
      <div class="sb"><span class="sb-k">Queue</span><span class="sb-v" id="sbQueue">—</span></div>
    </div>
  </div>
</div>

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

// Every section builds innerHTML from values it does not control: appId and origin come from a
// pairing request, printerName comes from the OS. This page holds the admin key, so markup injected
// through any of them would be a privilege escalation, not a cosmetic bug.
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
const escapeAttr = escapeHtml;

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.nav a').forEach(function (a) { a.classList.toggle('active', a.dataset.screen === name); });
  if (name === 'applications') refreshApplications();
  if (name === 'targets') refreshTargets();
}

document.querySelector('.nav').addEventListener('click', function (e) {
  const link = e.target.closest('a[data-screen]');
  if (link) showScreen(link.dataset.screen);
});

async function setStatusBar(level, apps, configs) {
  document.getElementById('sbDot').className = 'sb-dot' + (level === 'bad' ? ' bad' : level === 'warn' ? ' warn' : '');
  document.getElementById('sbRuntime').textContent = level === 'bad' ? 'Attention' : 'Healthy';
  document.getElementById('sbApps').textContent = apps.length + (apps.length === 1 ? ' connected' : ' connected');
  const targetCount = configs.reduce(function (n, c) { return n + Object.keys(c.targets || {}).length; }, 0);
  document.getElementById('sbTargets').textContent = targetCount + ' configured';
  try {
    const jobs = await api('/jobs');
    const active = (jobs || []).filter(function (j) { return j.status === 'pending' || j.status === 'printing'; }).length;
    document.getElementById('sbQueue').textContent = active === 0 ? 'Idle' : active + ' active';
  } catch { document.getElementById('sbQueue').textContent = '—'; }
}

${OVERVIEW_SCRIPT}
${APPLICATIONS_SCRIPT}
${TARGETS_SCRIPT}

refreshOverview().then(function () {
  api('/health').then(function (h) {
    document.getElementById('footVersion').textContent = 'v' + (h.runtimeVersion || h.version);
  }).catch(function () {});
});
</script>
</body>
</html>
`;
