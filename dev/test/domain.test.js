import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomain} from '../src/domain.js';
const kind='lnticket';
const ext=kind+'wasm';
function fixture() {
  const tables=new Map();let owner='alice',counter=0;const invoices=[];const posts=[];
  const h={
    get(t,id){return structuredClone(tables.get(`${owner}/${t}/${id}`)||null);},
    set(t,r){tables.set(`${owner}/${t}/${r.id}`,structuredClone(r));},
    page(t,filters={},offset=0,limit=1000){const all=[...tables.entries()].filter(([k,r])=>k.startsWith(`${owner}/${t}/`)&&Object.entries(filters).every(([f,v])=>r[f]===v)).map(([,r])=>structuredClone(r)).sort((a,b)=>a.id.localeCompare(b.id));return {rows:all.slice(offset,offset+limit),total:all.length};},
    wallets(){return [{id:owner+'-wallet',name:owner}];},
    currencies(){return ['sats','USD'];},fiat(amount){return Math.round(amount*1000);},id(){return `r${++counter}`;},now(){return 1700000000;},
    invoice(sourceId,amount,memo,metadata){const payment_hash=String(++counter).padStart(64,'0');const p={payment_hash,payment_request:'bolt11',checking_id:payment_hash,amount_msat:amount*1000,expires_at:1700003600};invoices.push({sourceId,amount,memo,metadata,...p});if(h.duringInvoice)h.duringInvoice(invoices.at(-1));return p;},
    post(url,body,id){posts.push({url,body,id});return h.httpStatus??200;}
  };
  const domain=createDomain(h);
  const data=kind==='lnticket'?{name:'Help',description:'Ask me',amount:5,flatrate:false,webhook:''}:kind==='eightball'?{name:'Fortune ⚡',description:'Ask',wordlist:'Yes\nNo\nMaybe',lnurlpayamount:10,base_url:'https://example.com'}:{currency:'USD',status:'open',company_name:'Shop',items:[{description:'Work',amount:'12.34',quantity:2}]};
  const create=()=>domain.createSource({...data,wallet:owner+'-wallet'});
  const request=source=>kind==='lnticket'?{id:source.id,name:'Buyer',email:'a@example.com',ltext:'two words',sats:1}:kind==='invoices'?{id:source.id,famount:500}:{id:source.id};
  const event=invoice=>({extension:ext,status:'success',pending:false,paymentHash:invoice.payment_hash,walletId:owner+'-wallet',amount:invoice.amount_msat,extra:{source_id:invoice.sourceId}});
  return {h,domain,data,create,request,event,invoices,posts,tables,owner(value){owner=value;}};
}
test('CRUD, owner isolation, public projection and wallet ownership',()=>{
 const f=fixture(),s=f.create();assert.equal(f.domain.listSources().total,1);
 assert.throws(()=>f.domain.createSource({...f.data,wallet:'bob-wallet'}),/Not your wallet/);
 const pub=f.domain.getPublic({id:s.id});assert.equal('wallet' in pub,false);assert.equal('wordlist' in pub,false);assert.equal('webhook' in pub,false);
 f.owner('bob');assert.equal(f.domain.listSources().total,0);assert.throws(()=>f.domain.updateSource({...f.data,id:s.id,wallet:'bob-wallet'}),/not found/);assert.throws(()=>f.domain.deleteSource({id:s.id}),/not found/);
 f.owner('alice');f.domain.deleteSource({id:s.id});assert.equal(f.domain.listSources().total,0);assert.throws(()=>f.domain.getPublic({id:s.id}),/not found/);
});
test('payments bind to a stored price; duplicate events count once',()=>{
 const f=fixture(),s=f.create(),payment=f.domain.createPayment(f.request(s)),invoice=f.invoices[0];
 assert.equal(f.domain.paymentStatus({attempt:payment.attempt}).paid,false);
 const e=f.event(invoice);f.domain.handleInvoicePaid(e);f.domain.handleInvoicePaid(e);
 assert.equal(f.domain.listRecords().total,1);assert.equal(f.domain.paymentStatus({attempt:payment.attempt}).paid,true);
 if(kind==='lnticket'){assert.equal(invoice.amount,10);assert.equal(f.domain.listSources().data[0].amountmade,10);}
 if(kind==='invoices'){assert.equal(invoice.amount,5000);assert.equal(f.domain.getPublic({id:s.id}).payments,500);}
});
test('reject forged settlement status, amount, hash, source and wallet',()=>{
 const f=fixture(),s=f.create();f.domain.createPayment(f.request(s));const e=f.event(f.invoices[0]);
 for(const patch of [{status:'pending'},{pending:true},{amount:1},{extension:'other'},{walletId:'bob-wallet'},{paymentHash:'a'.repeat(64)},{extra:{source_id:'missing'}}]) assert.throws(()=>f.domain.handleInvoicePaid({...e,...patch}));
 assert.equal(f.domain.listRecords().total,0);
});
test('settlement arriving before invoice return and after source deletion is retained',()=>{
 const f=fixture(),s=f.create();f.h.duringInvoice=i=>f.domain.handleInvoicePaid(f.event(i));
 const p=f.domain.createPayment(f.request(s));assert.equal(f.domain.paymentStatus({attempt:p.attempt}).paid,true);
 f.domain.deleteSource({id:s.id});f.domain.handleInvoicePaid(f.event(f.invoices[0]));assert.equal(f.domain.listRecords().total,1);
});
test('failure after invoice creation does not erase an early settlement',()=>{
 const f=fixture(),s=f.create();f.h.duringInvoice=i=>{f.domain.handleInvoicePaid(f.event(i));throw new Error('timeout');};
 assert.throws(()=>f.domain.createPayment(f.request(s)),/timeout/);assert.equal(f.domain.listRecords().total,1);
});
if(kind==='lnticket') {
 test('flat/per-word price and webhook privacy, failure, retry and deduplication',()=>{
  const f=fixture();const s=f.domain.createSource({...f.data,wallet:'alice-wallet',amount:21,flatrate:true,webhook:'https://hooks.example.com/ticket'});
  f.domain.createPayment(f.request(s));assert.equal(f.invoices[0].amount,21);f.h.httpStatus=500;
  f.domain.handleInvoicePaid(f.event(f.invoices[0]));let r=f.domain.listRecords().data[0];assert.equal(r.webhook_status,'failed');
  f.h.httpStatus=200;f.domain.retryWebhook({id:r.id});f.domain.handleInvoicePaid(f.event(f.invoices[0]));assert.equal(f.posts.length,2);assert.equal(f.posts[0].id,r.id);assert.deepEqual(Object.keys(f.posts[0].body),['form','name','email','content']);
  f.domain.deleteRecord({id:r.id});f.domain.handleInvoicePaid(f.event(f.invoices[0]));assert.equal(f.domain.listRecords().data.length,0);assert.equal(f.domain.listSources().data[0].amountmade,21);
 });
 test('message limits and empty messages are rejected before payment creation',()=>{const f=fixture(),s=f.create();for(const ltext of ['   ','x'.repeat(16001)])assert.throws(()=>f.domain.createPayment({...f.request(s),ltext}));assert.equal(f.invoices.length,0);});
}
if(kind==='eightball') {
 test('LNURL metadata is exactly bound to the invoice and callback enforces millisatoshis',()=>{
  const f=fixture(),s=f.create(),discovery=f.domain.lnurlPay({id:s.id});assert.equal(discovery.minSendable,10000);
  assert.throws(()=>f.domain.lnurlCallback({id:s.id,amount:9999}),/Amount/);
  const result=f.domain.lnurlCallback({id:s.id,amount:'10000'});assert.equal(f.invoices[0].metadata,discovery.metadata);assert.equal(result.successAction.tag,'message');assert.ok(s.wordlist.split('\n').includes(result.successAction.message));
  assert.equal(discovery.callback,`https://example.com/api/v1/ext/${ext}/lnurl/paycb/${s.id}`);
 });
 test('word list limits and origin injection rejected',()=>{const f=fixture();for(const patch of [{wordlist:''},{wordlist:'x'.repeat(145)},{base_url:'https://example.com@evil.com'}])assert.throws(()=>f.domain.createSource({...f.data,wallet:'alice-wallet',...patch}));});
}
if(kind==='invoices') {
 test('decimal arithmetic, multiple partial settlements, full payment and status gating',()=>{
  const f=fixture(),s=f.create();assert.equal(s.total,2468);
  for(const famount of [500,1968]){f.domain.createPayment({id:s.id,famount});f.domain.handleInvoicePaid(f.event(f.invoices.at(-1)));}
  const p=f.domain.getPublic({id:s.id});assert.equal(p.payments,2468);assert.equal(p.status,'paid');assert.equal(p.remaining,0);assert.throws(()=>f.domain.createPayment({id:s.id,famount:1}),/not open/);
  for(const status of ['draft','canceled']){const other=f.domain.createSource({...f.data,wallet:'alice-wallet',status});assert.throws(()=>f.domain.createPayment({id:other.id,famount:1}),/not open/);}
 });
 test('sats use sats; fiat uses minor units; invalid and excess amounts rejected',()=>{
  const f=fixture(),s=f.domain.createSource({...f.data,wallet:'alice-wallet',currency:'sats',items:[{description:'Item',amount:21,quantity:2}]});assert.equal(s.total,42);
  f.domain.createPayment({id:s.id,famount:21});assert.equal(f.invoices[0].amount,21);
  for(const famount of [0,-1,43,1.5])assert.throws(()=>f.domain.createPayment({id:s.id,famount}));
  assert.throws(()=>f.domain.createSource({...f.data,wallet:'alice-wallet',items:[{description:'Item',amount:'0.001',quantity:1}]}));
 });
 test('concurrent invoices retain both actual receipts, including overpayment',()=>{
  const f=fixture(),s=f.create();for(let i=0;i<2;i++)f.domain.createPayment({id:s.id,famount:2468});
  for(const invoice of f.invoices)f.domain.handleInvoicePaid(f.event(invoice));
  const p=f.domain.getPublic({id:s.id});assert.equal(p.payments,4936);assert.equal(p.remaining,0);
 });
}
