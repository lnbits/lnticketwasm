import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(`src/${name}.js`, root), 'utf8');
const internal = s => s.replace(/^export /gm, '');
const entry = read('index').replace(/^import .*from '\.\/(?:host|domain)\.js'\n/gm, '');
mkdirSync(new URL('dist/', root), {recursive:true});
writeFileSync(new URL('dist/index.js', root), [internal(read('host')), internal(read('domain')), entry].join('\n'));
