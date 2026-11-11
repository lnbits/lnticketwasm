import {readFileSync, writeFileSync} from 'node:fs';
const file = new URL('../../config.json',import.meta.url);
const origins = [...new Set(process.argv.slice(2).map(value=>{
  const url=new URL(value);
  if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw new Error('Supply HTTPS origins without paths or credentials.');
  return url.origin;
}))];
const config=JSON.parse(readFileSync(file));
config.permissions=config.permissions.filter(p=>p.id!=='http.request');
if(origins.length) config.permissions.push({id:'http.request',description:'Deliver paid ticket webhooks to approved HTTPS origins.',policies:origins.map(host=>({host}))});
writeFileSync(file,JSON.stringify(config,null,2)+'\n');
console.log('Webhook origins configured. Package and approve updated permissions before use.');
