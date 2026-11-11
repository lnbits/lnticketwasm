import {storageGet, storageSet, storageGetPaginated, createInvoicePublic, listUserWallets, randomId, now, httpRequest} from 'lnbits:extension/host'
import {listCurrencies as hostCurrencies, fiatToSats} from 'lnbits:extension/utils-currencies'
import {invoiceAmountMsat, invoiceExpiry} from 'lnbits:extension/utils-lightning'

export function createHost() {
  return {
    get(table, id) { const r = storageGet({table, id}); return r.dataJson ? JSON.parse(r.dataJson) : null; },
    set(table, row) { storageSet({table, dataJson:JSON.stringify(row)}); return row; },
    page(table, filters = {}, offset = 0, limit = 1000) {
      const r = storageGetPaginated({table, filtersJson:JSON.stringify(filters), search:'', searchFields:[], sortBy:'id', descending:false, limit, offset});
      return {rows:JSON.parse(r.rowsJson), total:Number(r.total)};
    },
    wallets() { return listUserWallets().wallets; },
    currencies() { return ['sats', ...hostCurrencies().currencies.filter(x => x !== 'sat' && x !== 'sats')]; },
    fiat(amount, currency) { return Number(fiatToSats({amount, currency}).amountSat); },
    id() { return randomId({prefix:'r'}).id; },
    now() { return Number(now().timestamp); },
    invoice(sourceId, amount, memo, metadata) {
      const r = createInvoicePublic({sourceId, amount, currency:'sat', memo, extra:[]});
      return {payment_hash:r.paymentHash, payment_request:r.paymentRequest, checking_id:r.checkingId,
        amount_msat:Number(invoiceAmountMsat({bolt11:r.paymentRequest}).amountMsat),
        expires_at:Number(invoiceExpiry({bolt11:r.paymentRequest}).expiresAt)};
    },
    post(url, body, id) { return httpRequest({method:'POST',url,headers:[['Content-Type','application/json'],['X-LNbits-Ticket-ID',id]],body:JSON.stringify(body)}).statusCode; }
  };
}
