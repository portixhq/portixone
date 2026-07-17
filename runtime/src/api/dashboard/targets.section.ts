/**
 * The dashboard's "Printer targets" section: markup and behaviour together.
 *
 * Kept out of dashboard.controller.ts because that file is already a 486-line self-contained page
 * and this is its most interactive section. Split by SECTION, not by technology — a css/html/js
 * split would move lines around without reducing coupling, whereas a section owns its own markup
 * and the code that drives it.
 *
 * The page stays one self-contained document with no build step: the Runtime ships as plain
 * compiled JS, and adding a bundler for an internal admin page would cost more than it returns.
 */

export const TARGETS_SECTION_HTML = `
  <section>
    <h2>Printer targets</h2>
    <p class="section-sub">
      Which application prints what, and where it lands on this machine. Apps print to a target
      (<span class="mono">receipt</span>, <span class="mono">kitchen</span>…) and never to a printer
      name — that's what lets one integration serve every customer.
    </p>
    <div id="targetsList" class="list"><p class="muted">Loading…</p></div>
  </section>`;

export const TARGETS_SECTION_STYLES = `
  .section-sub { color: var(--muted); font-size: 13px; line-height: 1.6; margin: -4px 0 14px; max-width: 68ch; }
  .app-group { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
  .app-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
  .app-id { font-weight: 600; font-size: 14px; }
  .app-origin { color: var(--muted); font-size: 12px; }
  .target-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); flex-wrap: wrap; }
  .target-name { min-width: 84px; font-weight: 600; font-size: 13px; }
  .target-printer { flex: 1; min-width: 160px; font-size: 13px; color: var(--muted); }
  .badge-ok { background: rgba(34,197,94,.14); color: #16a34a; }
  .badge-warn { background: rgba(234,179,8,.16); color: #a16207; }
  .badge-bad { background: rgba(239,68,68,.14); color: #dc2626; }
  .assign-row { display: flex; gap: 8px; align-items: center; padding-top: 10px; border-top: 1px dashed var(--line); flex-wrap: wrap; }
  .assign-row select { background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; font-size: 13px; font-family: inherit; }
  .btn-sm { padding: 5px 10px; font-size: 12px; border-radius: 7px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; }
  .btn-sm:hover { border-color: var(--brand); }
  .btn-sm:disabled { opacity: .5; cursor: default; }
  .btn-danger { color: #dc2626; }`;

/**
 * Client behaviour.
 *
 * Driven by PAIRED APPS, not by configured targets: `/printer-targets` only returns apps that
 * already have one, so a freshly paired app would be invisible here and you could never assign its
 * first target — which is the starting state of every install. So the two lists are merged.
 */
export const TARGETS_SECTION_SCRIPT = `
const PRINT_TARGETS = ['receipt', 'kitchen', 'bar', 'label', 'invoice', 'report'];
let availablePrinters = [];

// This section builds innerHTML from values it does not control: appId and origin come from a
// pairing request, printerName comes from the OS. This page holds the admin key, so injecting
// markup here would be a genuine privilege escalation — everything interpolated gets escaped.
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
const escapeAttr = escapeHtml;

function targetBadge(mapping) {
  if (!mapping) return '';
  if (mapping.invalidReason === 'printer_missing') return '<span class="badge badge-bad">printer missing</span>';
  if (mapping.verified) return '<span class="badge badge-ok">verified</span>';
  return '<span class="badge badge-warn">not tested</span>';
}

function targetRow(appId, origin, target, mapping) {
  return '<div class="target-row">'
    + '<span class="target-name mono">' + target + '</span>'
    + '<span class="target-printer">' + (mapping ? escapeHtml(mapping.printerName) : '<em>not configured</em>') + '</span>'
    + targetBadge(mapping)
    + '<button class="btn-sm" data-act="test" data-app="' + escapeAttr(appId) + '" data-origin="' + escapeAttr(origin) + '" data-target="' + target + '">Test</button>'
    + '<button class="btn-sm btn-danger" data-act="remove" data-app="' + escapeAttr(appId) + '" data-origin="' + escapeAttr(origin) + '" data-target="' + target + '">Remove</button>'
    + '</div>';
}

function assignRow(appId, origin) {
  const printerOpts = availablePrinters.map(function (p) {
    return '<option value="' + escapeAttr(p.name) + '">' + escapeHtml(p.name) + '</option>';
  }).join('');
  const targetOpts = PRINT_TARGETS.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
  return '<div class="assign-row">'
    + '<select class="js-target">' + targetOpts + '</select>'
    + '<span class="muted">→</span>'
    + '<select class="js-printer">' + printerOpts + '</select>'
    + '<button class="btn-sm" data-act="assign" data-app="' + escapeAttr(appId) + '" data-origin="' + escapeAttr(origin) + '">Assign</button>'
    + '</div>';
}

async function refreshTargets() {
  const el = document.getElementById('targetsList');
  try {
    // Paired apps are the source of truth for WHO can print here; configured targets only say what
    // has been set up so far. Merging them is what makes a never-configured app appear at all.
    const [pairings, targetsResponse, printers] = await Promise.all([
      api('/pairings').catch(function () { return []; }),
      api('/printer-targets').catch(function () { return { configurations: [] }; }),
      api('/printers').catch(function () { return []; }),
    ]);
    const configs = (targetsResponse && targetsResponse.configurations) || [];
    availablePrinters = printers || [];

    const groups = new Map();
    function keyOf(appId, origin) { return appId + '\\u0000' + origin; }
    function ensure(appId, origin) {
      const k = keyOf(appId, origin);
      if (!groups.has(k)) groups.set(k, { appId: appId, origin: origin, targets: {} });
      return groups.get(k);
    }
    (pairings || []).forEach(function (p) { ensure(p.appId, p.origin || '*'); });
    configs.forEach(function (c) { ensure(c.appId, c.origin).targets = c.targets || {}; });

    if (groups.size === 0) {
      el.innerHTML = '<p class="muted">No applications are paired with this machine yet. Once an app connects, its print targets appear here.</p>';
      return;
    }

    el.innerHTML = Array.from(groups.values()).map(function (g) {
      const configured = Object.keys(g.targets);
      const rows = configured.length
        ? configured.map(function (t) { return targetRow(g.appId, g.origin, t, g.targets[t]); }).join('')
        : '<div class="target-row"><span class="muted">No targets configured — this app cannot print by target yet.</span></div>';
      return '<div class="app-group">'
        + '<div class="app-head"><span class="app-id mono">' + escapeHtml(g.appId) + '</span>'
        + '<span class="app-origin mono">' + escapeHtml(g.origin) + '</span></div>'
        + rows + assignRow(g.appId, g.origin)
        + '</div>';
    }).join('');
  } catch (err) {
    el.innerHTML = '<p class="muted">Could not load printer targets: ' + escapeHtml(err.message) + '</p>';
  }
}

document.getElementById('targetsList').addEventListener('click', async function (event) {
  const btn = event.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const appId = btn.dataset.app;
  const origin = btn.dataset.origin;
  const q = '?origin=' + encodeURIComponent(origin);
  btn.disabled = true;
  try {
    if (act === 'assign') {
      const group = btn.closest('.app-group');
      const target = group.querySelector('.js-target').value;
      const printerName = group.querySelector('.js-printer').value;
      if (!printerName) throw new Error('No printer available to assign');
      await api('/printer-targets/' + encodeURIComponent(appId) + '/' + target, {
        method: 'PUT',
        body: JSON.stringify({ printerName: printerName, origin: origin }),
      });
    } else if (act === 'remove') {
      await api('/printer-targets/' + encodeURIComponent(appId) + '/' + btn.dataset.target + q, { method: 'DELETE' });
    } else if (act === 'test') {
      const target = btn.dataset.target;
      await api('/printer-targets/' + encodeURIComponent(appId) + '/' + target + '/test' + q, { method: 'POST' });
      // "Assigned" and "verified" are different claims: only a human who saw paper come out can
      // promote one to the other, so we ask instead of assuming the queue accepting it means it printed.
      if (window.confirm('A test ticket was sent to the ' + target + ' target.\\n\\nDid it actually print?')) {
        await api('/printer-targets/' + encodeURIComponent(appId) + '/' + target + '/confirm' + q, { method: 'POST' });
      }
    }
  } catch (err) {
    window.alert('Could not complete that: ' + err.message);
  } finally {
    btn.disabled = false;
    await refreshTargets();
    await refreshJobs();
  }
});`;
