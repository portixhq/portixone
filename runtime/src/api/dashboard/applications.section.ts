/**
 * Applications — who is allowed to print here, and whether they can.
 *
 * Every field shown is one the Runtime genuinely tracks. `Environment` (Production/Development) and
 * `SDK version` are deliberately absent: neither is recorded anywhere today, and inferring an
 * environment from the origin would be a guess presented as a fact — the exact mistake the licensing
 * design spent a whole phase avoiding (production is decided by an activation, never by a header).
 * They return when something real reports them.
 */
export const APPLICATIONS_HTML = `
  <section id="screen-applications" class="screen">
    <h1>Applications</h1>
    <p class="lede">
      Applications that have been granted permission to print on this machine. Each one prints to
      logical targets — it never names your printers.
    </p>
    <div id="appsList"><p class="muted">Loading…</p></div>
  </section>`;

export const APPLICATIONS_SCRIPT = `
function relativeTime(iso) {
  if (!iso) return 'never';
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return secs + 's ago';
  if (secs < 3600) return Math.round(secs / 60) + ' min ago';
  if (secs < 86400) return Math.round(secs / 3600) + 'h ago';
  return Math.round(secs / 86400) + 'd ago';
}

function appCard(app, cfg) {
  const targets = Object.keys((cfg && cfg.targets) || {});
  const targetChips = targets.length
    ? targets.map(function (t) {
        const bad = cfg.targets[t].invalidReason;
        return '<span class="badge badge-' + (bad ? 'bad' : 'ok') + '">' + t + '</span>';
      }).join(' ')
    : '<span class="badge badge-warn">none configured</span>';

  return '<div class="card">'
    + '<div class="card-head">'
    + '<span class="card-title">' + escapeHtml(app.appId) + '</span>'
    + '<span class="badge badge-ok">Approved</span>'
    + '<span class="spacer"></span>'
    + '<button class="btn" data-app-act="manage" data-app="' + escapeAttr(app.appId) + '">Manage targets</button>'
    + '<button class="btn btn-danger" data-app-act="disconnect" data-device="' + escapeAttr(app.deviceId) + '" data-app="' + escapeAttr(app.appId) + '">Disconnect</button>'
    + '</div>'
    + '<div class="card-meta">'
    + '<div><div class="fact-k">Origin</div><div class="fact-v mono" style="font-size:12.5px">' + escapeHtml(app.origin || 'local (no origin)') + '</div></div>'
    + '<div><div class="fact-k">Tenant</div><div class="fact-v">' + escapeHtml(app.tenant || '—') + '</div></div>'
    + '<div><div class="fact-k">Last activity</div><div class="fact-v">' + relativeTime(app.lastUsedAt) + '</div></div>'
    + '<div><div class="fact-k">Printer targets</div><div class="fact-v">' + targetChips + '</div></div>'
    + '</div></div>';
}

async function refreshApplications() {
  const el = document.getElementById('appsList');
  try {
    const [apps, targets] = await Promise.all([
      api('/pairings'),
      api('/printer-targets').catch(function () { return { configurations: [] }; }),
    ]);
    const configs = (targets && targets.configurations) || [];
    if (!apps || apps.length === 0) {
      el.innerHTML = '<div class="empty"><div class="empty-title">No applications connected yet.</div>'
        + '<div class="empty-sub">When an application asks to print here, you will be asked to approve it.</div></div>';
      return;
    }
    el.innerHTML = apps.map(function (app) {
      const cfg = configs.find(function (c) { return c.appId === app.appId && c.origin === (app.origin || '*'); });
      return appCard(app, cfg);
    }).join('');
  } catch (err) {
    el.innerHTML = '<p class="muted">Could not load applications: ' + escapeHtml(err.message) + '</p>';
  }
}

document.getElementById('appsList').addEventListener('click', async function (event) {
  const btn = event.target.closest('button[data-app-act]');
  if (!btn) return;
  if (btn.dataset.appAct === 'manage') {
    showScreen('targets');
    return;
  }
  // Revoking is immediate and total — the app's token stops working on the next request — so it is
  // worth one question rather than a silent click.
  if (!window.confirm('Disconnect ' + btn.dataset.app + '?\\n\\nIt will stop being able to print here until it is approved again.')) return;
  btn.disabled = true;
  try {
    await api('/pairings/' + encodeURIComponent(btn.dataset.device), { method: 'DELETE' });
  } catch (err) {
    window.alert('Could not disconnect: ' + err.message);
  } finally {
    btn.disabled = false;
    await refreshApplications();
    await refreshOverview();
  }
});`;
