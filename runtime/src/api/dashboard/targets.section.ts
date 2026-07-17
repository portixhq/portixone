/**
 * Printer Targets — this replaces the old "Printers" list.
 *
 * The Runtime manages destinations, not devices: an application prints to `receipt`, and which
 * physical printer that means is this installation's business. A printer list would have put the
 * device back at the centre and invited applications to name it, which is the whole problem targets
 * exist to remove.
 *
 * Driven by PAIRED APPS merged with configured targets, not by the configured list alone:
 * `/printer-targets` only returns apps that already have one, so a freshly paired app would be
 * invisible here and you could never assign its first target — the starting state of every install.
 */
export const TARGETS_HTML = `
  <section id="screen-targets" class="screen">
    <h1>Printer targets</h1>
    <p class="lede">
      Where each application's print jobs land on this machine. Applications ask for a destination;
      you decide the device.
    </p>
    <div id="targetsList"><p class="muted">Loading…</p></div>
  </section>`;

export const TARGETS_SCRIPT = `
const PRINT_TARGETS = ['receipt', 'kitchen', 'bar', 'label', 'invoice', 'report'];
let availablePrinters = [];

function targetBadge(mapping) {
  if (mapping.invalidReason === 'printer_missing') return '<span class="badge badge-bad">printer missing</span>';
  if (mapping.verified) return '<span class="badge badge-ok">verified</span>';
  return '<span class="badge badge-warn">not tested</span>';
}

function targetRow(appId, origin, target, mapping) {
  return '<div class="row">'
    + '<span class="row-name">' + target + '</span>'
    + '<span class="row-val mono" style="font-size:12.5px">' + escapeHtml(mapping.printerName) + '</span>'
    + targetBadge(mapping)
    + '<button class="btn" data-act="test" data-app="' + escapeAttr(appId) + '" data-origin="' + escapeAttr(origin) + '" data-target="' + target + '">Print test</button>'
    + '<button class="btn btn-danger" data-act="remove" data-app="' + escapeAttr(appId) + '" data-origin="' + escapeAttr(origin) + '" data-target="' + target + '">Remove</button>'
    + '</div>';
}

function assignRow(appId, origin) {
  if (availablePrinters.length === 0) {
    return '<div class="row"><span class="muted">No printers detected on this machine.</span></div>';
  }
  const printerOpts = availablePrinters.map(function (p) {
    return '<option value="' + escapeAttr(p.name) + '">' + escapeHtml(p.name) + '</option>';
  }).join('');
  const targetOpts = PRINT_TARGETS.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
  return '<div class="row">'
    + '<select class="js-target">' + targetOpts + '</select>'
    + '<span class="muted">→</span>'
    + '<select class="js-printer">' + printerOpts + '</select>'
    + '<button class="btn btn-primary" data-act="assign" data-app="' + escapeAttr(appId) + '" data-origin="' + escapeAttr(origin) + '">Configure</button>'
    + '</div>';
}

async function refreshTargets() {
  const el = document.getElementById('targetsList');
  try {
    const [pairings, targetsResponse, printers] = await Promise.all([
      api('/pairings').catch(function () { return []; }),
      api('/printer-targets').catch(function () { return { configurations: [] }; }),
      api('/printers').catch(function () { return []; }),
    ]);
    availablePrinters = printers || [];
    const configs = (targetsResponse && targetsResponse.configurations) || [];

    const groups = new Map();
    function ensure(appId, origin) {
      const k = appId + '\\u0000' + origin;
      if (!groups.has(k)) groups.set(k, { appId: appId, origin: origin, targets: {} });
      return groups.get(k);
    }
    (pairings || []).forEach(function (p) { ensure(p.appId, p.origin || '*'); });
    configs.forEach(function (c) { ensure(c.appId, c.origin).targets = c.targets || {}; });

    if (groups.size === 0) {
      el.innerHTML = '<div class="empty"><div class="empty-title">No printer targets configured.</div>'
        + '<div class="empty-sub">Targets appear here once an application is connected.</div></div>';
      return;
    }

    el.innerHTML = Array.from(groups.values()).map(function (g) {
      const configured = Object.keys(g.targets);
      const rows = configured.length
        ? configured.map(function (t) { return targetRow(g.appId, g.origin, t, g.targets[t]); }).join('')
        : '<div class="row"><span class="muted">Nothing configured yet — this application cannot print.</span></div>';
      return '<div class="card">'
        + '<div class="card-head"><span class="card-title">' + escapeHtml(g.appId) + '</span>'
        + '<span class="muted mono" style="font-size:12px">' + escapeHtml(g.origin) + '</span></div>'
        + '<div style="margin-top:8px">' + rows + assignRow(g.appId, g.origin) + '</div>'
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
      const card = btn.closest('.card');
      await api('/printer-targets/' + encodeURIComponent(appId) + '/' + card.querySelector('.js-target').value, {
        method: 'PUT',
        body: JSON.stringify({ printerName: card.querySelector('.js-printer').value, origin: origin }),
      });
    } else if (act === 'remove') {
      await api('/printer-targets/' + encodeURIComponent(appId) + '/' + btn.dataset.target + q, { method: 'DELETE' });
    } else if (act === 'test') {
      const target = btn.dataset.target;
      await api('/printer-targets/' + encodeURIComponent(appId) + '/' + target + '/test' + q, { method: 'POST' });
      // "Assigned" and "verified" are different claims. The queue accepting a job is not evidence
      // that paper came out of the right device — only a human who watched it is.
      if (window.confirm('A test ticket was sent to the ' + target + ' target.\\n\\nDid it actually print?')) {
        await api('/printer-targets/' + encodeURIComponent(appId) + '/' + target + '/confirm' + q, { method: 'POST' });
      }
    }
  } catch (err) {
    window.alert('Could not complete that: ' + err.message);
  } finally {
    btn.disabled = false;
    await refreshTargets();
    await refreshOverview();
  }
});`;
