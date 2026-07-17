/**
 * Overview — the default screen.
 *
 * It exists to answer four questions in about three seconds: is the Runtime healthy, can my
 * applications print, are my printers configured, and do I need to do anything. Everything here is
 * derived from state the Runtime actually has. Deliberately absent, because nothing reports them
 * yet: Windows Service status, tray status, last heartbeat, and the update channel (which lives in
 * the tray, not the Runtime). Showing a hardcoded "Running" for those would be a lie the first time
 * one of them wasn't.
 */
export const OVERVIEW_HTML = `
  <section id="screen-overview" class="screen active">
    <h1>Portix Runtime</h1>
    <p class="lede">Running locally on this machine.</p>

    <div id="healthCard" class="health">
      <span class="health-dot"></span>
      <div>
        <div class="health-title" id="healthTitle">Checking…</div>
        <div class="health-sub" id="healthSub"></div>
      </div>
    </div>

    <div class="facts">
      <div class="fact"><div class="fact-k">Runtime</div><div class="fact-v" id="factRuntime">—</div></div>
      <div class="fact"><div class="fact-k">API</div><div class="fact-v" id="factApi">—</div></div>
      <div class="fact"><div class="fact-k">Version</div><div class="fact-v mono" id="factVersion">—</div></div>
      <div class="fact"><div class="fact-k">Printing</div><div class="fact-v" id="factMode">—</div></div>
    </div>

    <h2>Needs attention</h2>
    <div id="attentionList"></div>
  </section>`;

export const OVERVIEW_SCRIPT = `
// "Do I need to do anything?" is the only question here worth computing, so compute it from real
// state rather than showing a reassuring constant: a target whose printer vanished, or an app that
// is paired but has no way to print, are the two things that silently break a till.
function renderAttention(apps, configs) {
  const el = document.getElementById('attentionList');
  const items = [];

  configs.forEach(function (c) {
    Object.keys(c.targets || {}).forEach(function (t) {
      if (c.targets[t].invalidReason === 'printer_missing') {
        items.push({
          level: 'bad',
          title: 'The ' + t + ' target points at a printer that is gone',
          sub: escapeHtml(c.appId) + ' — "' + escapeHtml(c.targets[t].printerName) + '" is no longer installed. Reassign it.',
        });
      }
    });
  });

  // Deduplicate by appId+origin, not by pairing: one app can hold several pairings (a second
  // browser profile, a re-pair after clearing site data), but targets are scoped to appId+origin,
  // so all of them share one configuration. Listing it per pairing would report one problem three
  // times and make the list look worse than reality.
  const seen = new Set();
  apps.forEach(function (app) {
    const origin = app.origin || '*';
    const key = app.appId + '\\u0000' + origin;
    if (seen.has(key)) return;
    seen.add(key);
    const cfg = configs.find(function (c) { return c.appId === app.appId && c.origin === origin; });
    if (!cfg || Object.keys(cfg.targets || {}).length === 0) {
      items.push({
        level: 'warn',
        title: escapeHtml(app.appId) + ' cannot print yet',
        sub: 'It is connected, but no printer target is configured for it.',
      });
    }
  });

  if (items.length === 0) {
    el.innerHTML = '<div class="empty"><div class="empty-title">Nothing needs you.</div>'
      + '<div class="empty-sub">Applications are connected and their targets are configured.</div></div>';
    return;
  }
  el.innerHTML = items.map(function (i) {
    return '<div class="card"><div class="card-head">'
      + '<span class="badge badge-' + (i.level === 'bad' ? 'bad' : 'warn') + '">' + (i.level === 'bad' ? 'Action required' : 'Not ready') + '</span>'
      + '<span class="card-title">' + i.title + '</span></div>'
      + '<div class="muted" style="margin-top:6px;font-size:13px">' + i.sub + '</div></div>';
  }).join('');
}

async function refreshOverview() {
  const card = document.getElementById('healthCard');
  try {
    const health = await api('/health');
    // runtimeVersion is the product version. The older "version" field carries the PROTOCOL version
    // and made this read "v0.2.0" on a 0.1.1 Runtime — useless to anyone checking their build.
    document.getElementById('factVersion').textContent = health.runtimeVersion || health.version;
    document.getElementById('factRuntime').textContent = 'Running';
    document.getElementById('factApi').textContent = 'Listening';
    document.getElementById('factMode').textContent = health.simulated ? 'Simulated (mock driver)' : 'Real printers';

    const [apps, targets] = await Promise.all([
      api('/pairings').catch(function () { return []; }),
      api('/printer-targets').catch(function () { return { configurations: [] }; }),
    ]);
    const configs = (targets && targets.configurations) || [];
    renderAttention(apps || [], configs);

    const blocked = configs.some(function (c) {
      return Object.keys(c.targets || {}).some(function (t) { return c.targets[t].invalidReason; });
    });
    // Red only when printing is actually blocked — anything softer would train people to ignore it.
    card.className = 'health' + (blocked ? ' is-error' : '');
    document.getElementById('healthTitle').textContent = blocked ? 'Action required' : 'Healthy';
    document.getElementById('healthSub').textContent = blocked
      ? 'A printer target no longer resolves. Applications using it cannot print.'
      : 'The Runtime is running and reachable.';
    setStatusBar(blocked ? 'bad' : 'ok', apps || [], configs);
  } catch (err) {
    card.className = 'health is-error';
    document.getElementById('healthTitle').textContent = 'Runtime unreachable';
    document.getElementById('healthSub').textContent = err.message;
    setStatusBar('bad', [], []);
  }
}`;
