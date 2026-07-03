# PortixOne

> A secure edge runtime that enables browser-based applications to communicate with local hardware through a unified developer API.

**Status**: MVP foundation (Scaffold v0.1)
**Scope**: Windows local printing only
**Runtime**: Node.js + TypeScript, headless
**SDK**: JavaScript only

## Visión

PortixOne no es un "device bridge" puntual, sino una plataforma de infraestructura para conectar software web con hardware local de forma segura, consistente y simple — impresoras, cajones, escáneres, básculas, displays, y más, todo bajo un modelo de capacidades unificado (`Print`, `Cut`, `OpenDrawer`, `ReadWeight`, ...).

Los primeros 90 días acotan el alcance a un único flujo de alto valor: **impresión local confiable desde una web app, en Windows, vía SDK JS**. Todo lo demás (cajón, básculas, bluetooth, mobile, multi-tenant, marketplace) queda deliberadamente fuera hasta validar esto.

## Estructura del monorepo

| Carpeta | Estado | Descripción |
|---|---|---|
| [`runtime/`](runtime) | Activo (MVP) | Portix Runtime — bridge local headless (API + WebSocket + printer manager) |
| [`sdk-js/`](sdk-js) | Activo (MVP) | SDK JavaScript para invocar `print()` desde una web app |
| [`packages/protocol/`](packages/protocol) | Activo (MVP) | Contrato de mensajes compartido entre runtime y SDKs |
| [`packages/shared/`](packages/shared) | Activo (MVP) | Constantes y errores compartidos |
| [`packages/escpos/`](packages/escpos) | Activo (MVP) | Construcción de comandos ESC/POS |
| [`examples/`](examples) | Activo (MVP) | Demo HTML mínima — Time to First Print |
| [`docs/`](docs) | Placeholder | Quickstart y troubleshooting |
| [`cloud/`](cloud) | Planned | Auth, proyectos, API keys, dashboard |
| [`sdk-dotnet/`](sdk-dotnet) | Planned | SDK .NET |
| [`sdk-python/`](sdk-python) | Planned | SDK Python |
| [`sdk-go/`](sdk-go) | Planned | SDK Go |
| [`playground/`](playground) | Planned | Edge Platform completa |
| [`website/`](website) | Planned | Landing + waitlist |
| [`blog/`](blog) | Planned | Contenido técnico / SEO |

## Arquitectura en capas

1. **Cloud Platform** — autenticación, proyectos, API keys, analíticas, licencias, dashboard.
2. **Secure Communication Layer** — HTTPS/WebSockets/TLS entre nube y runtime.
3. **Portix Runtime (Edge Runtime)** — autentica, valida, enruta comandos y ejecuta trabajos localmente.
4. **Hardware Abstraction Layer** — impresoras, cajones, escáneres, básculas, displays, USB, Serial, Bluetooth, TCP/IP.

## Quickstart

```bash
npm install
npm run dev        # levanta el runtime en localhost
npm run build       # build de todos los workspaces
npm run typecheck
```

Luego abre [`examples/quickstart-html/index.html`](examples/quickstart-html/index.html) para probar el flujo de impresión de extremo a extremo.

## Red de repositorios PortixOne

Este monorepo es la fuente de verdad para desarrollo. El resto de la red de conocimiento vive en repos separados, cada uno resolviendo una intención de búsqueda distinta:

| Repo | Qué es |
|---|---|
| [`portix-runtime`](https://github.com/PortixOne/portix-runtime) | Mirror público de solo lectura del runtime (`runtime/` aquí) |
| [`portix-sdk-js`](https://github.com/PortixOne/portix-sdk-js) | Mirror público de solo lectura del SDK JS (`sdk-js/` aquí) |
| [`awesome-web-printing`](https://github.com/PortixOne/awesome-web-printing) | Lista curada del ecosistema de impresión web |
| [`browser-printing-examples`](https://github.com/PortixOne/browser-printing-examples) | Ejemplos ejecutables por framework (vanilla, React, Vue) |
| [`escpos-cheatsheet`](https://github.com/PortixOne/escpos-cheatsheet) | Referencia rápida de comandos ESC/POS |
| [`thermal-printer-test-files`](https://github.com/PortixOne/thermal-printer-test-files) | Archivos `.bin` ESC/POS reales para probar impresoras/parsers |
