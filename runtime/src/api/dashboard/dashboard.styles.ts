/**
 * Control Center styling.
 *
 * Rules that are load-bearing, not taste:
 *  - Purple is healthy. There is no green anywhere — purple is the identity, and a second "good"
 *    colour would dilute it into a traffic light.
 *  - Amber and red are reserved for states that actually need a human. Red in particular means
 *    "printing is blocked", never "something is unusual".
 *  - Typography and whitespace carry the hierarchy; borders are a last resort. Cards are almost
 *    invisible on purpose: this should read as infrastructure that is fine, not as a control panel
 *    demanding attention.
 */
export const DASHBOARD_STYLES = `
  :root {
    color-scheme: light;
    --brand: #8f00a8;
    --brand-rgb: 143, 0, 168;
    --surface: #ffffff;
    --surface-2: #fbfbfc;
    --ink: #16161a;
    --muted: #71717a;
    --faint: #a1a1aa;
    --line: #ececf0;
    --warn: #b45309;
    --warn-bg: rgba(245, 166, 35, 0.14);
    --danger: #dc2626;
    --danger-bg: rgba(220, 38, 38, 0.10);
    --brand-bg: rgba(var(--brand-rgb), 0.10);
  }

  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    background: var(--surface);
    color: var(--ink);
    font-family: Switzer, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace; }

  /* ── Shell ─────────────────────────────────────────────────────────── */
  .shell { display: grid; grid-template-columns: 216px 1fr; min-height: 100vh; }
  .side { border-right: 1px solid var(--line); padding: 26px 16px; display: flex; flex-direction: column; gap: 26px; }
  .brand-mark { padding: 0 8px; }
  .brand-mark .name { font-size: 12px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
  .nav { display: flex; flex-direction: column; gap: 2px; }
  .nav a {
    display: block; padding: 7px 10px; border-radius: 7px; color: var(--muted);
    text-decoration: none; font-size: 13.5px; cursor: pointer; transition: background .12s, color .12s;
  }
  .nav a:hover { color: var(--ink); background: var(--surface-2); }
  .nav a.active { color: var(--ink); background: var(--brand-bg); font-weight: 500; }
  .side-foot { margin-top: auto; padding: 0 10px; font-size: 11.5px; color: var(--faint); line-height: 1.7; }

  .main { display: flex; flex-direction: column; min-width: 0; }
  .content { flex: 1; padding: 40px 44px 32px; max-width: 940px; }
  .screen { display: none; }
  .screen.active { display: block; }

  h1 { font-size: 21px; font-weight: 600; letter-spacing: -.01em; margin: 0 0 4px; }
  .lede { color: var(--muted); font-size: 13.5px; margin: 0 0 30px; max-width: 62ch; }
  h2 { font-size: 12px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--faint); margin: 34px 0 12px; }

  /* ── Health ────────────────────────────────────────────────────────── */
  .health { display: flex; align-items: center; gap: 14px; padding: 22px 24px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-2); }
  .health-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--brand); flex: none; }
  .health.is-warn .health-dot { background: var(--warn); }
  .health.is-error .health-dot { background: var(--danger); }
  .health-title { font-size: 17px; font-weight: 600; letter-spacing: -.01em; }
  .health-sub { color: var(--muted); font-size: 13px; margin-top: 1px; }

  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 2px 0; margin-top: 26px; }
  .fact { padding: 14px 0; }
  .fact-k { font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--faint); }
  .fact-v { font-size: 14.5px; margin-top: 3px; }

  /* ── Cards & rows ──────────────────────────────────────────────────── */
  .card { border: 1px solid var(--line); border-radius: 14px; padding: 20px 22px; margin-bottom: 12px; }
  .card-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .card-title { font-size: 15px; font-weight: 600; }
  .card-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin-top: 16px; }
  .row { display: flex; align-items: center; gap: 14px; padding: 14px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .row:last-child { border-bottom: none; }
  .row-name { min-width: 92px; font-weight: 500; }
  .row-val { flex: 1; min-width: 150px; color: var(--muted); font-size: 13.5px; }
  .spacer { flex: 1; }

  .badge { font-size: 11px; padding: 2.5px 8px; border-radius: 999px; font-weight: 500; letter-spacing: .01em; }
  .badge-ok { background: var(--brand-bg); color: var(--brand); }
  .badge-warn { background: var(--warn-bg); color: var(--warn); }
  .badge-bad { background: var(--danger-bg); color: var(--danger); }
  .badge-idle { background: var(--surface-2); color: var(--faint); border: 1px solid var(--line); }

  /* ── Buttons ───────────────────────────────────────────────────────── */
  button { font-family: inherit; }
  .btn { padding: 6px 12px; font-size: 12.5px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; transition: border-color .12s, background .12s; }
  .btn:hover:not(:disabled) { border-color: var(--brand); }
  .btn:disabled { opacity: .45; cursor: default; }
  .btn-primary { background: var(--brand); border-color: var(--brand); color: #fff; font-weight: 500; }
  .btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
  .btn-danger { color: var(--danger); }
  .btn-danger:hover:not(:disabled) { border-color: var(--danger); }
  select { background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; font-size: 12.5px; font-family: inherit; max-width: 240px; }

  /* ── Empty states ──────────────────────────────────────────────────── */
  .empty { border: 1px dashed var(--line); border-radius: 14px; padding: 40px 24px; text-align: center; }
  .empty-title { font-weight: 500; }
  .empty-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }

  /* ── Status bar ────────────────────────────────────────────────────── */
  .statusbar {
    position: sticky; bottom: 0; display: flex; gap: 28px; align-items: center;
    padding: 10px 44px; border-top: 1px solid var(--line); background: rgba(255,255,255,.86);
    backdrop-filter: blur(8px); font-size: 12px;
  }
  .sb { display: flex; gap: 7px; align-items: center; }
  .sb-k { color: var(--faint); }
  .sb-v { color: var(--ink); }
  .sb-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); }
  .sb-dot.warn { background: var(--warn); }
  .sb-dot.bad { background: var(--danger); }

  .muted { color: var(--muted); }
  .note { font-size: 12px; color: var(--faint); margin-top: 10px; }

  @media (max-width: 780px) {
    .shell { grid-template-columns: 1fr; }
    .side { flex-direction: row; align-items: center; gap: 14px; border-right: none; border-bottom: 1px solid var(--line); padding: 12px 16px; overflow-x: auto; }
    .nav { flex-direction: row; }
    .side-foot { display: none; }
    .content { padding: 26px 18px; }
    .statusbar { padding: 10px 18px; gap: 16px; overflow-x: auto; }
  }`;
