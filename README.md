# LNTicket WASM

Independent WASM clone of `lnbits/extensions/lnticket` in this checkout. Extension ID: `lnticketwasm`. Version 0.1.0, minimum LNbits 1.7.1.

## Features

Create, edit, delete and share forms; flat/per-word sat prices; paid contact submissions; ticket detail and deletion; form/ticket CSV exports; optional HTTPS webhooks with visible delivery state and retry.

The browser uses the LNbits iframe bridge; server logic runs in a WebAssembly component. The extension requests no outgoing-payment permissions. All private records are owner-scoped. Public responses omit wallet credentials and internal configuration.

## Build and checks

Use an already installed `jco` compiler (validated with @bytecodealliance/jco 1.32.1), Node, and this checkout's Python environment. No new project dependencies are needed.

```sh
make check
make build JCO=/path/to/jco
make runtime-check
make package
```

`make check` runs domain regressions, JS syntax checks, and manifest checks. `make runtime-check` instantiates the compiled component through LNbits' real host/WIT adapters with isolated SQLite storage and FakeWallet invoices. It checks schema creation, two-owner isolation, missing permissions, invoice creation, settlement, and replay. The Python helper scripts are development tools; `make package` excludes them from the installable ZIP and runs LNbits' archive validator.

Sources are in `dev/src`; browser code is in `static`; schema and declarative migrations are in `storage`. Build directly in this directory. Each clone is self-contained.

## Installation

Install `dist/lnticketwasm-0.1.0.zip` through the normal WASM installation/permission approval workflow. Use the accompanying SHA-256 file to check the release artifact. This package requires the approved host changes in this checkout: optional public-invoice LNURL metadata, the CSV/print parent bridge, and the read-only theme bridge. A stock 1.7.1 build without those changes does not provide all clone features.

After activation, management is at `/ext/lnticketwasm`; public links are `/ext/lnticketwasm/<id>`. The clone has separate storage and can coexist with its Python original. Existing Python records and URLs are not automatically migrated. Installation, activation and permissions in the running instance are separate from building this directory.

## API

Registered endpoints are under `/api/v1/ext/lnticketwasm`; see `config.json` for exact routes, authentication and public owner-context sources. Normal operations return `{"ok":true,"data":...}` or `{"ok":false,"error":"..."}`; LNURL routes return protocol objects directly. Management lists are paginated in batches of 25 using `offset`. Authenticated requests use the LNbits account session, not Python extension wallet-key authentication.

Payment creation returns `attempt`, `payment_hash`, `payment_request`, `sats`, and expiry. `/payments/<attempt>` exposes payment status only (plus Eightball's response after settlement). Public request data never determines the receiving wallet or overrides the configured price. Public invoice URLs are bearer links and must be shared only with their intended recipients.

## Payment correctness and limits

Payment attempts snapshot the receiving wallet, amount and private data before invoice creation. Successful settlements validate extension, source, hash, amount and wallet binding. Receipts use the payment hash as their stable ID, so duplicate events cannot add the same payment twice. Deleting a source hides it but preserves outstanding invoice bindings and accounting records.

Public payment polling currently reads the recorded settlement events. The core event dispatcher has no durable retry queue, and the existing WASM API cannot independently look up a missed settlement. A restricted invoice-status host API is awaiting separate approval; until then this remains a recovery-parity gap with the Python originals.

The current storage host has no multi-operation transactions or compare-and-set. Invoice creation and receipt writes are not one transaction. A timeout after invoice creation can leave an unreturned invoice; it does not reverse payment. Receipts remain authoritative, and totals are computed from them rather than mutable counters. Aggregate scans are bounded at 20,000 records per source; CSV exports are bounded at 10,000 rows and 1 MiB.

The UI follows the original Quasar layouts, table columns and top dialogs, including the public payment pages. Render functions use the existing LNbits Vue/Quasar assets inside the sandbox without compiling Jinja or Vue templates. Colors, gradients and light/dark mode follow the active LNbits theme through the read-only theme bridge, including live changes. CSV and printing require a parent confirmation. Unlike the Python originals, public pages receive no wallet API keys. Prices and ownership are enforced by the server.

## Webhooks

No outbound hosts are granted by default. Before packaging, run:

```sh
node dev/scripts/configure-webhooks.mjs https://hooks.example.com
make package
```

Approve the resulting HTTP permission during installation/update. The form can then use HTTPS URLs on that origin. Core rejects private-network targets, credentials and redirects. Webhooks preserve the original JSON body (`form`, `name`, `email`, `content`) and add `X-LNbits-Ticket-ID` for receiver-side deduplication. Delivery is at-least-once: concurrent event delivery or a lost HTTP response may repeat a webhook. Paid tickets survive delivery failure; use Retry webhook in the merchant view. A deleted ticket keeps its accounting receipt but is hidden and its contact/message fields are cleared in that receipt.
