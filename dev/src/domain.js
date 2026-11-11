const EXTENSION = 'lnticketwasm';
const KIND = 'lnticket';

export function createDomain(host) {
  function fail(message) { const e = new Error(message); e.public = true; throw e; }
  function text(value, label, max = 512, required = true) {
    if (value == null && !required) return '';
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`Invalid ${label}.`);
    return value.trim();
  }
  function integer(value, label, min = 1, max = 100000000000) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(n) || n < min || n > max) fail(`Invalid ${label}.`);
    return n;
  }
  function money(value) {
    const s = String(value);
    if (!/^\d+(\.\d{1,2})?$/.test(s)) fail('Amounts must have at most two decimal places.');
    const [whole, fraction = ''] = s.split('.');
    return integer(Number(whole) * 100 + Number(fraction.padEnd(2, '0')), 'item price');
  }
  function row(table, id) {
    const value = host.get(table, text(id, 'ID', 160));
    if (!value) fail('Record not found.');
    return {...JSON.parse(value.data), id:value.id, ...(value.wallet ? {wallet:value.wallet} : {}), ...(value.source_id ? {source_id:value.source_id} : {}), ...(table === 'sources' ? {deleted:value.deleted} : {})};
  }
  function save(table, value) {
    const record = {id:value.id, data:JSON.stringify(value)};
    if (table === 'sources' || table === 'attempts') record.wallet = value.wallet;
    if (table === 'attempts' || table === 'receipts') record.source_id = value.source_id;
    if (table === 'receipts') record.hidden = value.hidden === true;
    if (table === 'sources') record.deleted = value.deleted === true;
    host.set(table, record);
    return value;
  }
  function all(table, filters = {}) {
    const result = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
      const page = host.page(table, filters, offset, 1000);
      result.push(...page.rows.map(r => ({...JSON.parse(r.data), id:r.id})));
      if (offset + page.rows.length >= page.total) return result;
      if (!page.rows.length) break;
    }
    fail('Too many records for one request. Narrow the selection.');
  }
  function ownedWallet(id) {
    id = text(id, 'wallet', 128);
    if (!host.wallets().some(w => w.id === id)) fail('Not your wallet.');
    return id;
  }
  function source(id, allowDeleted = false) {
    const s = row('sources', id);
    if (s.deleted && !allowDeleted) fail('Record not found.');
    return s;
  }
  function receipts(id) { return all('receipts', id ? {source_id:id} : {}); }
  function totalPaid(id) {
    return receipts(id).reduce((sum, r) => integer(sum + r.credit, 'payment total', 0), 0);
  }
  function enriched(s) {
    if (KIND === 'lnticket') return {...s, amountmade:totalPaid(s.id)};
    if (KIND === 'invoices') {
      const payments = totalPaid(s.id);
      return {...s, payments, status:payments >= s.total ? 'paid' : s.status, remaining:Math.max(0, s.total - payments)};
    }
    return s;
  }
  function origin(value) {
    const s = text(value, 'public base URL', 512);
    if (!/^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(s)) fail('Use a public HTTP(S) origin without a path.');
    return s;
  }
  
  function validateSource(r) {
    const webhook = text(r.webhook, 'webhook URL', 2048, false);
    if (webhook && !/^https:\/\/[^\s/@]+(?:\/[^\s]*)?$/.test(webhook)) fail('Webhooks require an approved HTTPS destination.');
    return {name:text(r.name,'name'), description:text(r.description,'description',4000,false),
      amount:integer(r.amount,'price',0), flatrate:r.flatrate === true || r.flatrate === 1, webhook};
  }
  function publicSource(s) { return {id:s.id, name:s.name, description:s.description, amount:s.amount, flatrate:s.flatrate}; }
  function paymentMemo(s) { return `Ticket: ${s.name}`.slice(0,512); }
  function paymentDetails(s,r) {
    const ltext = text(r.ltext,'message',16000);
    const count = ltext.split(/\s+/u).length;
    const sats = integer(s.flatrate ? s.amount : s.amount * count,'ticket price');
    return {sats,credit:sats,data:{name:text(r.name,'name',200),email:text(r.email,'email',320,false),ltext,webhook:s.webhook}};
  }


  function begin(s, request, lnurl = false) {
    const details = paymentDetails(s, request);
    const id = host.id();
    // Persist the wallet, price, and private payload before requesting an invoice.
    // A payment event may arrive before the invoice call returns.
    const attempt = {id, source_id:s.id, wallet:s.wallet, credit:details.credit, sats:details.sats,
      amount_msat:integer(details.sats * 1000, 'invoice amount'), time:host.now(), details:details.data,
      payment_hash:'', payment_request:'', expires_at:0};
    save('attempts', attempt);
    const invoice = host.invoice(id, details.sats, paymentMemo(s), details.metadata);
    if (invoice.amount_msat !== attempt.amount_msat) fail('The returned invoice amount does not match the requested price.');
    save('attempts', {...attempt, ...invoice});
    const response = {...invoice, bolt11:invoice.payment_request, attempt:id, sats:details.sats};
    if (lnurl) return {pr:invoice.payment_request, routes:[], successAction:{tag:'message', message:details.data.word}};
    return response;
  }
  function recordEvent(event) {
    const extra = event.extra || {};
    if (event.extension !== EXTENSION || event.status !== 'success' || event.pending !== false || !extra.source_id) fail('Invalid settlement event.');
    const attempt = row('attempts', extra.source_id);
    const hash = text(event.paymentHash, 'payment hash', 128);
    if (!/^[a-f0-9]{64}$/i.test(hash) || Number(event.amount) !== attempt.amount_msat) fail('Settlement does not match the invoice.');
    if (attempt.payment_hash && attempt.payment_hash !== hash) fail('Settlement does not match the invoice.');
    // Core authenticates extension_context, including the original source wallet.
    const binding = event.payment?.extension_context;
    if (binding && (binding.source_id !== attempt.id || binding.extension_id !== EXTENSION || binding.wallet_id !== event.walletId)) fail('Invalid payment binding.');
    if (!binding && event.walletId !== attempt.wallet) fail('Settlement wallet does not match.');
    let receipt;
    const existing = host.get('receipts', hash);
    if (existing) receipt = row('receipts', hash);
    else {
      receipt = {id:hash, source_id:attempt.source_id, attempt:attempt.id, wallet:attempt.wallet,
        credit:attempt.credit, sats:attempt.sats, amount_msat:attempt.amount_msat, time:host.now(),
        paid:true, details:KIND === 'lnticket' ? {...attempt.details, ltext:''} : attempt.details};
      // A stable hash key makes repeated/concurrent settlement writes converge.
      save('receipts', receipt);
    }
    if (KIND === 'lnticket') deliver(receipt);
    return {paid:true, payment_hash:hash};
  }
  function deliver(receipt) {
    const details = row('attempts', receipt.attempt).details;
    const url = details.webhook;
    if (!url) return {status:'not-configured'};
    const previous = host.get('deliveries', receipt.id);
    if (previous && JSON.parse(previous.data).status === 'delivered') return {status:'delivered'};
    let status = 'failed';
    try {
      const code = host.post(url, {form:receipt.source_id, name:details.name, email:details.email, content:details.ltext}, receipt.id);
      if (code >= 200 && code < 300) status = 'delivered';
    } catch (_) { /* Keep the paid receipt and expose a merchant retry. */ }
    save('deliveries', {id:receipt.id, status, time:host.now()});
    return {status};
  }
  return {
    listWallets() { return host.wallets(); },
    listCurrencies() { return host.currencies(); },
    listSources(request = {}) {
      const offset = integer(request.offset ?? 0, 'offset', 0);
      const page = host.page('sources', {deleted:false}, offset, 25);
      return {data:page.rows.map(r => enriched({...JSON.parse(r.data), id:r.id})), total:page.total};
    },
    createSource(request) {
      const s = validateSource(request);
      return save('sources', {...s, id:host.id(), wallet:ownedWallet(request.wallet), time:host.now(), deleted:false});
    },
    updateSource(request) {
      const previous = source(request.id);
      const next = validateSource(request);
      return save('sources', {...previous, ...next, wallet:ownedWallet(request.wallet), id:previous.id});
    },
    deleteSource(request) {
      const s = source(request.id);
      // Preserve outstanding invoice bindings, but remove the public page and dashboard entry.
      save('sources', {...s, deleted:true});
      return {status:true};
    },
    getPublic(request) { return publicSource(enriched(source(request.id))); },
    createPayment(request) { return begin(enriched(source(request.id)), request); },
    paymentStatus(request) {
      const attempt = row('attempts', request.attempt);
      const found = all('receipts', {source_id:attempt.source_id}).find(r => r.attempt === attempt.id);
      return {paid:!!found, ...(KIND === 'eightball' && found ? {word:found.details.word} : {})};
    },
    listRecords(request = {}) {
      const offset = integer(request.offset ?? 0, 'offset', 0);
      const page = host.page('receipts', {hidden:false, ...(request.source ? {source_id:text(request.source,'source ID',160)} : {})}, offset, 25);
      return {data:page.rows.map(r => {
        const v = JSON.parse(r.data);
        const delivery = KIND === 'lnticket' ? host.get('deliveries', v.id) : null;
        return {...v, ...(KIND === 'lnticket' ? row('attempts',v.attempt).details : v.details), form:v.source_id, webhook_status:delivery ? JSON.parse(delivery.data).status : v.details.webhook ? 'failed' : 'not-configured'};
      }).filter(r => !r.hidden), total:page.total};
    },
    deleteRecord(request) {
      const r = row('receipts', request.id);
      // Keep the accounting receipt so deletion cannot make an event count twice.
      save('receipts', {...r, hidden:true, details:{...r.details, name:'', email:'', ltext:''}});
      const attempt = row('attempts', r.attempt);
      save('attempts', {...attempt, details:{...attempt.details, name:'', email:'', ltext:''}});
      return {status:true};
    },
    retryWebhook(request) { return deliver(row('receipts', request.id)); },
    handleInvoicePaid:recordEvent,
    lnurlPay(request) {
      const s = source(request.id);
      return {tag:'payRequest', callback:`${s.base_url}/api/v1/ext/${EXTENSION}/lnurl/paycb/${s.id}`,
        minSendable:s.lnurlpayamount * 1000, maxSendable:s.lnurlpayamount * 1000, metadata:metadata(s)};
    },
    lnurlCallback(request) {
      const s = source(request.id);
      if (integer(request.amount, 'LNURL amount') !== s.lnurlpayamount * 1000) fail('Amount does not match the Eightball price.');
      return begin(s, request, true);
    }
  };
}
