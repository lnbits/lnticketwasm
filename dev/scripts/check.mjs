import {readFileSync, existsSync} from 'node:fs';
const config=JSON.parse(readFileSync('config.json'));
const wit=readFileSync('wasm/lnbits-extension.wit','utf8');
for(const e of config.wasm.exports) if(!wit.includes(`export ${e.name}:`)) throw new Error(`Missing WIT export ${e.name}`);
for(const route of config.ui_routes) if(!existsSync(route.entrypoint)) throw new Error('Missing UI');
if(config.permissions.some(p=>p.id.startsWith('wallet.pay'))) throw new Error('Receive-only clone must not request spending');
console.log('Manifest, WIT, UI and receive-only permissions: OK');
