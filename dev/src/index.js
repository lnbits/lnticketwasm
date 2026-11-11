import {createHost} from './host.js'
import {createDomain} from './domain.js'
const domain = createDomain(createHost())
function run(op, raw, lnurl = false) {
  try {
    const request = JSON.parse(raw || '{}');
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Invalid request.');
    const data = domain[op](request);
    return JSON.stringify(lnurl ? data : {ok:true, data});
  } catch (error) {
    const message = error.public === true ? error.message : 'The request could not be completed.';
    return JSON.stringify(lnurl ? {status:'ERROR', reason:message} : {ok:false, error:message});
  }
}
export function listWallets(request) { return run('listWallets', request, false); }
export function listCurrencies(request) { return run('listCurrencies', request, false); }
export function listSources(request) { return run('listSources', request, false); }
export function createSource(request) { return run('createSource', request, false); }
export function updateSource(request) { return run('updateSource', request, false); }
export function deleteSource(request) { return run('deleteSource', request, false); }
export function getPublic(request) { return run('getPublic', request, false); }
export function createPayment(request) { return run('createPayment', request, false); }
export function paymentStatus(request) { return run('paymentStatus', request, false); }
export function listRecords(request) { return run('listRecords', request, false); }
export function deleteRecord(request) { return run('deleteRecord', request, false); }
export function retryWebhook(request) { return run('retryWebhook', request, false); }
export function handleInvoicePaid(request) { return run('handleInvoicePaid', request, false); }
