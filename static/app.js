/* Render functions preserve the original Quasar UI without runtime template compilation. */
;(() => {
  'use strict'
  const {h, reactive} = Vue
  const Q = Quasar
  // The sandbox disallows native form submissions. Keep keyboard and button
  // submission entirely in JavaScript, with all requests going through the bridge.
  const Form = {
    props: ['onSubmit'],
    setup(props, {slots}) {
      return () =>
        h(
          'div',
          {
            role: 'form',
            onClick(event) {
              if (event.target.closest('button[type="submit"]')) {
                event.preventDefault()
                props.onSubmit()
              }
            },
            onKeydown(event) {
              if (
                event.key === 'Enter' &&
                event.target.tagName === 'INPUT' &&
                !event.target.closest('.q-select')
              ) {
                event.preventDefault()
                props.onSubmit()
              }
            }
          },
          slots.default?.()
        )
    }
  }
  const id = document.body.dataset.extension
  const kind = id.replace(/wasm$/, '')
  const noun = {lnticket: 'forms', eightball: 'eightb', invoices: 'invoice'}[
    kind
  ]
  const singular = {
    lnticket: 'Form',
    eightball: 'Magic 8 Ball',
    invoices: 'Invoice'
  }[kind]
  const listTitle = {
    lnticket: 'Forms',
    eightball: 'Magic 8 Ball',
    invoices: 'Invoices'
  }[kind]
  const client = window.createLNbitsExtensionClient({
    extensionId: id,
    timeout: 60000
  })
  const api = (path, method = 'GET', body) =>
    client.api(
      method,
      `/api/v1/ext/${id}${path}`,
      body === undefined ? undefined : JSON.parse(JSON.stringify(body))
    )
  const state = reactive({
    ready: false,
    busy: false,
    error: '',
    context: null,
    wallets: [],
    currencies: [],
    sources: [],
    records: [],
    public: null,
    editor: null,
    share: null,
    ticket: null,
    deleting: null,
    payment: null,
    paymentStatus: '',
    payAmount: null,
    contact: {name: '', email: '', ltext: ''},
    sourcePage: {page: 1, rowsPerPage: 10, rowsNumber: 0},
    recordPage: {page: 1, rowsPerPage: 10, rowsNumber: 0}
  })
  let timer
  const date = value => new Date(value * 1000).toLocaleString()
  const amount = (value, currency) =>
    currency === 'sats' ? String(value || 0) : ((value || 0) / 100).toFixed(2)
  const money = (value, currency) => `${amount(value, currency)} ${currency}`
  const shareUrl = source =>
    `${location.origin}/ext/${id}/${encodeURIComponent(source.id)}`
  const sourcePath = kind === 'invoices' ? '/invoices' : `/${noun}`
  const column = (label, field, format) => ({
    name: field,
    label,
    field,
    align: 'left',
    ...(format ? {format} : {})
  })
  const sourceColumns =
    kind === 'lnticket'
      ? [
          column('ID', 'id'),
          column('Name', 'name'),
          column('Wallet', 'wallet'),
          column('Webhook', 'webhook'),
          column('Description', 'description'),
          column('Flat Rate', 'flatrate'),
          column('Amount', 'amount')
        ]
      : kind === 'eightball'
        ? [
            column('ID', 'id'),
            column('Name', 'name'),
            column('Description', 'description'),
            column('Wallet', 'wallet')
          ]
        : [
            column('ID', 'id'),
            column('Status', 'status'),
            column('Created', 'time', date),
            column('Wallet', 'wallet'),
            column('Currency', 'currency'),
            column('Company Name', 'company_name'),
            column('First Name', 'first_name'),
            column('Last Name', 'last_name'),
            column('Email', 'email'),
            column('Phone', 'phone'),
            column('Address', 'address')
          ]
  const recordColumns = [
    column('Form', 'form'),
    column('Name', 'name'),
    column('Email', 'email'),
    column('Ticket', 'ltext'),
    column('Cost', 'sats')
  ]
  async function run(action) {
    if (state.busy) return
    state.busy = true
    state.error = ''
    try {
      await action()
    } catch (error) {
      state.error = error.message || 'Request failed.'
      // Parent notification remains visible above an open iframe dialog.
      client.notify(state.error, 'negative').catch(() => {})
    } finally {
      state.busy = false
    }
  }
  const btn = (label, action, props = {}) =>
    h(Q.QBtn, {
      label,
      unelevated: true,
      color: 'primary',
      disable: state.busy,
      onClick: () => run(action),
      ...props
    })
  const flat = (label, action, props = {}) =>
    btn(label, action, {flat: true, color: 'grey', ...props})
  const icon = (name, label, action, props = {}) =>
    btn(undefined, action, {
      icon: name,
      dense: true,
      size: 'sm',
      color: 'grey-7',
      'aria-label': label,
      title: label,
      ...props
    })
  const section = children => h(Q.QCardSection, {}, () => children)
  const card = (children, props = {}) => h(Q.QCard, props, () => children)
  const row = (children, cls = '') =>
    h('div', {class: `row items-center ${cls}`}, children)
  const heading = text => h('h6', {class: 'text-subtitle1 q-my-none'}, text)
  const qr = value =>
    h('div', {class: 'qr'}, [
      h(window.QrcodeVue.default || window.QrcodeVue, {
        value,
        size: 260,
        level: 'M',
        renderAs: 'svg'
      })
    ])
  function input(label, target, key, props = {}) {
    return h(Q.QInput, {
      filled: true,
      dense: true,
      label,
      modelValue: target[key],
      'onUpdate:modelValue': value => {
        target[key] = value
      },
      ...props
    })
  }
  function select(label, target, key, options) {
    return h(Q.QSelect, {
      filled: true,
      dense: true,
      label,
      options,
      emitValue: true,
      mapOptions: true,
      modelValue: target[key],
      'onUpdate:modelValue': value => {
        target[key] = value
      }
    })
  }
  function dialog(show, close, children, wide = false) {
    return h(
      Q.QDialog,
      {
        modelValue: !!show,
        position: 'top',
        'onUpdate:modelValue': value => {
          if (!value) close()
        }
      },
      () =>
        card(children, {
          class: `q-pa-lg q-pt-xl clone-dialog${wide ? ' wide' : ''}`
        })
    )
  }
  const dialogActions = (primary, close) =>
    row([primary, flat('Cancel', close, {class: 'q-ml-auto'})], 'q-mt-lg')
  const walletSelect = data =>
    select(
      'Wallet *',
      data,
      'wallet',
      state.wallets.map(w => ({label: w.name, value: w.id}))
    )
  async function loadList(records = false, pagination) {
    const key = records ? 'recordPage' : 'sourcePage'
    const next = pagination || state[key]
    let offset = (next.page - 1) * next.rowsPerPage
    let result = await api(
      `${records ? '/records' : sourcePath}?offset=${offset}`
    )
    if (offset >= result.total && next.page > 1) {
      next.page = Math.max(1, Math.ceil(result.total / next.rowsPerPage))
      offset = (next.page - 1) * next.rowsPerPage
      result = await api(
        `${records ? '/records' : sourcePath}?offset=${offset}`
      )
    }
    state[records ? 'records' : 'sources'] = result.data.slice(
      0,
      next.rowsPerPage
    )
    state[key] = {...next, rowsNumber: result.total}
  }
  async function refresh() {
    await loadList()
    if (kind === 'lnticket') await loadList(true)
  }
  async function exportCsv(records = false) {
    const rows = []
    const columns = records ? recordColumns : sourceColumns
    for (let offset = 0; offset < 10000; offset += 25) {
      const page = await api(
        `${records ? '/records' : sourcePath}?offset=${offset}`
      )
      rows.push(...page.data)
      if (offset + 25 >= page.total)
        return client.request('ui.download_csv', {
          filename: `${id}-${records ? 'tickets' : noun}.csv`,
          columns: columns.map(c => c.label),
          rows: rows.map(r =>
            columns.map(c =>
              c.format ? c.format(r[c.field]) : (r[c.field] ?? '')
            )
          )
        })
    }
    throw new Error('Export is limited to 10,000 records.')
  }
  function openEditor(source) {
    const data = source
      ? JSON.parse(JSON.stringify(source))
      : {
          wallet: state.wallets[0]?.id || '',
          name: '',
          description: '',
          amount: 1,
          flatrate: false,
          webhook: '',
          wordlist:
            'yes\nno\nmaybe\nask again later\nbetter not tell you now\ncannot predict now\nconcentrate and ask again\nmy reply is no\nmy sources say no\noutlook not so good\nvery doubtful',
          lnurlpayamount: 10,
          currency: 'sats',
          status: 'draft',
          items: []
        }
    if (kind === 'invoices' && source)
      data.items = data.items.map(i => ({
        ...i,
        amount: amount(i.amount, data.currency)
      }))
    state.editor = data
  }
  async function saveSource() {
    const data = {...state.editor, base_url: location.origin}
    await api(
      `/${noun}${data.id ? '/' + data.id : ''}`,
      data.id ? 'PUT' : 'POST',
      data
    )
    state.editor = null
    await loadList()
  }
  function editor() {
    const d = state.editor
    if (!d) return null
    let fields
    if (kind === 'lnticket')
      fields = [
        walletSelect(d),
        input('Form name', d, 'name', {maxlength: 512}),
        input('Webhook (optional)', d, 'webhook', {
          hint: 'A URL to be called whenever this link receives a payment.'
        }),
        input('Description', d, 'description', {
          type: 'textarea',
          maxlength: 4000
        }),
        row([
          h('div', {class: 'col-5'}, [
            h(Q.QToggle, {
              label: d.flatrate ? 'Charge flat rate' : 'Charge per word',
              color: 'primary',
              modelValue: d.flatrate,
              'onUpdate:modelValue': value => {
                d.flatrate = value
              }
            })
          ]),
          h('div', {class: 'col-7'}, [
            input('Amount', d, 'amount', {type: 'number', min: 0, step: 1})
          ])
        ])
      ]
    if (kind === 'eightball')
      fields = [
        input('Name', d, 'name', {
          placeholder: 'Name for your eightball',
          maxlength: 512
        }),
        input('Description', d, 'description', {
          placeholder: 'Description for your eightball',
          maxlength: 4000
        }),
        walletSelect(d),
        input('LNURL-pay amount', d, 'lnurlpayamount', {
          type: 'number',
          min: 1,
          step: 1
        }),
        input('Responses', d, 'wordlist', {
          type: 'textarea',
          maxlength: 16000,
          hint: 'One response per line, up to 144 characters each.'
        })
      ]
    if (kind === 'invoices')
      fields = [
        walletSelect(d),
        select('Currency *', d, 'currency', state.currencies),
        select('Status *', d, 'status', ['draft', 'open', 'paid', 'canceled']),
        ...[
          ['Company Name', 'company_name', 'LNbits Labs'],
          ['First Name', 'first_name', 'Satoshi'],
          ['Last Name', 'last_name', 'Nakamoto'],
          ['Email', 'email', 'satoshi@example.com'],
          ['Phone', 'phone', '+81 (012)-345-6789'],
          ['Address', 'address', '']
        ].map(([label, key, placeholder]) =>
          input(label, d, key, {
            placeholder,
            type: key === 'address' ? 'textarea' : 'text',
            maxlength: 1024
          })
        ),
        h(Q.QList, {bordered: true, separator: true}, () => [
          ...d.items.map((item, index) =>
            h(Q.QItem, {key: index, class: 'line-item'}, () => [
              input('Item', item, 'description', {placeholder: 'Jelly Beans'}),
              input('Amount', item, 'amount', {
                type: 'number',
                min: 0,
                step: 'any'
              }),
              input('Qty', item, 'quantity', {type: 'number', min: 1, step: 1}),
              icon('delete', 'Remove item', () => {
                d.items.splice(index, 1)
              })
            ])
          ),
          h(Q.QItem, {}, () =>
            flat(
              'Add Line Item',
              () => {
                d.items.push({description: '', amount: '', quantity: 1})
              },
              {icon: 'add', color: undefined}
            )
          )
        ])
      ]
    return dialog(d, () => {
      state.editor = null
    }, [
      h(Form, {class: 'q-gutter-md', onSubmit: () => run(saveSource)}, () => [
        ...fields,
        dialogActions(
          h(Q.QBtn, {
            unelevated: true,
            color: 'primary',
            label: `${d.id ? 'Update' : 'Create'} ${singular}`,
            type: 'submit',
            loading: state.busy,
            disable: !d.wallet
          }),
          () => {
            state.editor = null
          }
        )
      ])
    ])
  }
  function managementTable(records = false) {
    const columns = records ? recordColumns : sourceColumns
    const pagination = records ? state.recordPage : state.sourcePage
    return h(
      Q.QTable,
      {
        flat: true,
        dense: kind !== 'invoices',
        rowKey: 'id',
        rows: records ? state.records : state.sources,
        columns,
        pagination,
        rowsPerPageOptions: [10, 25],
        loading: state.busy,
        onRequest: props => run(() => loadList(records, props.pagination))
      },
      {
        header: props =>
          h(Q.QTr, {props}, () => [
            h(Q.QTh, {autoWidth: true, 'aria-label': 'Open'}),
            ...props.cols.map(c =>
              h(Q.QTh, {key: c.name, props}, () => c.label)
            ),
            h(Q.QTh, {autoWidth: true, 'aria-label': 'Actions'})
          ]),
        body: props => {
          const r = props.row
          return h(Q.QTr, {props}, () => [
            h(Q.QTd, {autoWidth: true}, () =>
              row(
                records
                  ? [
                      icon('launch', 'View ticket', () => {
                        state.ticket = r
                      })
                    ]
                  : [
                      ...(kind === 'invoices'
                        ? [
                            icon('edit', 'Edit Invoice', () => openEditor(r), {
                              class: 'q-mr-sm'
                            })
                          ]
                        : []),
                      icon(
                        kind === 'lnticket' ? 'link' : 'launch',
                        'Open public page',
                        () => client.openNewTab(shareUrl(r))
                      )
                    ],
                'no-wrap'
              )
            ),
            ...props.cols.map(c =>
              h(Q.QTd, {key: c.name, props, title: String(c.value ?? '')}, () =>
                String(
                  records && c.field === 'ltext' && c.value.length > 20
                    ? c.value.slice(0, 20) + '...'
                    : (c.value ?? '')
                )
              )
            ),
            h(Q.QTd, {autoWidth: true}, () =>
              row(
                [
                  ...(!records && kind !== 'invoices'
                    ? [
                        icon('edit', `Edit ${singular}`, () => openEditor(r), {
                          flat: true,
                          size: 'xs',
                          color: 'light-blue'
                        })
                      ]
                    : []),
                  ...(!records
                    ? [
                        icon(
                          'qr_code',
                          'Share / QR',
                          () => {
                            state.share = r
                          },
                          {flat: true, size: 'xs', color: 'grey'}
                        )
                      ]
                    : []),
                  ...(records && r.webhook_status === 'failed'
                    ? [
                        icon(
                          'refresh',
                          'Retry webhook',
                          async () => {
                            await api(`/tickets/${r.id}/webhook`, 'POST', {})
                            await loadList(true)
                          },
                          {flat: true, color: 'orange'}
                        )
                      ]
                    : []),
                  icon(
                    'cancel',
                    records ? 'Delete ticket' : `Delete ${singular}`,
                    () => {
                      state.deleting = {row: r, records}
                    },
                    {flat: true, size: 'xs', color: 'pink'}
                  )
                ],
                'no-wrap'
              )
            )
          ])
        }
      }
    )
  }
  function apiHelp() {
    return h(
      Q.QExpansionItem,
      {icon: 'code', label: 'API documentation', group: 'extras'},
      () =>
        section([
          h(
            'p',
            {},
            `Manage ${listTitle.toLowerCase()} with your authenticated LNbits session.`
          ),
          h('code', {class: 'api-path'}, `GET /api/v1/ext/${id}${sourcePath}`),
          h('code', {class: 'api-path'}, `POST /api/v1/ext/${id}/${noun}`),
          h('code', {class: 'api-path'}, `PUT /api/v1/ext/${id}/${noun}/{id}`),
          h(
            'code',
            {class: 'api-path'},
            `DELETE /api/v1/ext/${id}/${noun}/{id}`
          )
        ])
    )
  }
  function admin() {
    const sideTitle = {
      lnticket: 'Support Tickets',
      eightball: 'Magic 8 Ball',
      invoices: 'Invoices'
    }[kind]
    const tableCard = (name, records = false) =>
      card([
        section([
          row(
            [
              h('div', {class: 'col'}, [heading(name)]),
              flat('Export to CSV', () => exportCsv(records))
            ],
            'no-wrap q-mb-md'
          ),
          managementTable(records)
        ])
      ])
    return h('div', {class: 'row q-col-gutter-md'}, [
      h(
        'div',
        {
          class: `col-12 ${kind === 'invoices' ? '' : 'col-md-8'} col-lg-7 q-gutter-y-md`
        },
        [
          card([section([btn(`New ${singular}`, () => openEditor())])]),
          tableCard(listTitle),
          ...(kind === 'lnticket' ? [tableCard('Tickets', true)] : [])
        ]
      ),
      h(
        'aside',
        {
          class: `col-12 ${kind === 'invoices' ? '' : 'col-md-4'} col-lg-5 q-gutter-y-md`
        },
        [
          card([
            section([
              heading(`LNbits ${sideTitle} extension`),
              ...(kind === 'eightball'
                ? [
                    h(
                      'p',
                      {class: 'q-mb-none q-mt-md'},
                      'Pay sats and return a random word from a list. Use for Magic 8 Ball and selling things like Satoshi quotes.'
                    )
                  ]
                : [])
            ]),
            h(Q.QSeparator),
            h(Q.QList, {}, () => [
              apiHelp(),
              ...(kind === 'eightball'
                ? [
                    h(Q.QSeparator),
                    h(
                      Q.QExpansionItem,
                      {icon: 'info', label: 'More info', group: 'extras'},
                      () =>
                        section([
                          h(
                            'p',
                            {},
                            'Use for Magic 8 Ball and selling things like Satoshi quotes.'
                          ),
                          h('small', {}, [
                            'Created by ',
                            h(
                              'a',
                              {
                                href: 'https://github.com/benarc',
                                target: '_blank',
                                rel: 'noopener noreferrer',
                                onClick: e => {
                                  e.preventDefault()
                                  run(() =>
                                    client.openNewTab(
                                      'https://github.com/benarc'
                                    )
                                  )
                                }
                              },
                              'Ben Arc'
                            ),
                            '.'
                          ])
                        ])
                    )
                  ]
                : [])
            ])
          ])
        ]
      )
    ])
  }
  async function copy(value) {
    await Q.copyToClipboard(value)
    await client.notify('Copied to clipboard.', 'positive')
  }
  async function startPayment(data) {
    const invoice = await api(
      `/public/${state.public.id}/payments`,
      'POST',
      data
    )
    state.payAmount = null
    state.payment = invoice
    state.paymentStatus = 'Waiting for payment…'
    clearTimeout(timer)
    async function poll() {
      try {
        const result = await api(
          `/payments/${encodeURIComponent(invoice.attempt)}`
        )
        if (
          state.payment !== invoice &&
          state.payment?.attempt !== invoice.attempt
        )
          return
        if (result.paid) {
          state.paymentStatus =
            kind === 'eightball' ? result.word : 'Payment received. Thank you!'
          if (kind === 'invoices')
            state.public = await api(
              `/public/${encodeURIComponent(state.context.routeParams.id)}`
            )
          if (kind === 'lnticket')
            state.contact = {name: '', email: '', ltext: ''}
          return
        }
        if (invoice.expires_at && Date.now() / 1000 > invoice.expires_at) {
          state.paymentStatus = 'Invoice expired. Please request a new payment.'
          return
        }
        timer = setTimeout(poll, 2500)
      } catch (error) {
        if (!state.payment) return
        state.paymentStatus = error.message
        timer = setTimeout(poll, 5000)
      }
    }
    timer = setTimeout(poll, 1000)
  }
  function closePayment() {
    clearTimeout(timer)
    state.payment = null
  }
  function ticketPublic(s) {
    const d = state.contact
    const words = d.ltext.trim() ? d.ltext.trim().split(/\s+/u).length : 0
    return h('div', {class: 'row q-col-gutter-md justify-center'}, [
      h('div', {class: 'col-12 col-md-7 col-lg-6'}, [
        card(
          [
            section([
              h('h3', {class: 'q-my-none'}, s.name),
              h('br'),
              h('h5', {class: 'q-my-none'}, s.description),
              h('br'),
              h(
                Form,
                {
                  class: 'q-gutter-md',
                  onSubmit: () => run(() => startPayment({...d}))
                },
                () => [
                  input('Your name', d, 'name', {maxlength: 200}),
                  input(
                    'Your email (optional, if you want a reply)',
                    d,
                    'email',
                    {type: 'email', maxlength: 320}
                  ),
                  input(
                    `${s.amount} sats${s.flatrate ? '' : ' per word'}`,
                    d,
                    'ltext',
                    {type: 'textarea', maxlength: 16000}
                  ),
                  h(
                    'p',
                    {},
                    `${words ? (s.flatrate ? s.amount : s.amount * words) : 0} sats to pay`
                  ),
                  dialogActions(
                    h(Q.QBtn, {
                      unelevated: true,
                      color: 'primary',
                      type: 'submit',
                      label: 'Submit',
                      loading: state.busy,
                      disable: !d.name.trim() || !words
                    }),
                    () => {
                      state.contact = {name: '', email: '', ltext: ''}
                    }
                  )
                ]
              )
            ])
          ],
          {class: 'q-pa-lg'}
        )
      ])
    ])
  }
  function eightballPublic(s) {
    const lnurl = encodeLnurl(s.lnurl_url)
    return h('div', {class: 'row q-col-gutter-md justify-center'}, [
      h('div', {class: 'col-12 col-sm-6 col-md-5 col-lg-4'}, [
        card(
          [
            section([
              qr(lnurl.toUpperCase()),
              row(
                [flat('Copy LNURL', () => copy(lnurl), {outline: true})],
                'justify-center q-gutter-sm q-mt-md'
              )
            ])
          ],
          {class: 'q-pa-lg'}
        )
      ]),
      h('div', {class: 'col-12 col-sm-6 col-md-5 col-lg-4 q-gutter-y-md'}, [
        card([
          section([
            h('h6', {class: 'text-subtitle1 q-mb-sm q-mt-none'}, s.name),
            h('p', {class: 'q-my-none'}, s.description)
          ]),
          h(Q.QSeparator),
          section([
            h('p', {}, `${s.lnurlpayamount} sats`),
            btn('Pay and reveal', () => startPayment({}))
          ])
        ])
      ])
    ])
  }
  function details(entries) {
    return h(Q.QList, {bordered: true, separator: true}, () =>
      entries.map(([label, value]) =>
        h(Q.QItem, {}, () => [
          h(Q.QItemSection, {}, () => h('b', {}, label)),
          h(Q.QItemSection, {class: 'detail-value'}, () => value)
        ])
      )
    )
  }
  function printInvoice(s) {
    return client.request('ui.print_document', {
      title: `Invoice ${s.id}`,
      lines: [
        `Created: ${date(s.time)}`,
        s.company_name,
        `${s.first_name} ${s.last_name}`,
        s.email,
        s.phone,
        s.address,
        `Status: ${s.status}`,
        `Total: ${money(s.total, s.currency)}`,
        `Paid: ${money(s.payments, s.currency)}`,
        `Due: ${money(s.remaining, s.currency)}`
      ],
      columns: ['Item', 'Quantity', 'Unit price', 'Total'],
      rows: s.items.map(i => [
        i.description,
        String(i.quantity),
        amount(i.amount, s.currency),
        amount(i.amount * i.quantity, s.currency)
      ])
    })
  }
  function invoicePublic(s) {
    return h('div', {id: 'invoicePage', class: 'q-gutter-y-md'}, [
      card([
        section([
          row(
            [
              h('div', {class: 'col-12 col-sm-6'}, [
                row([
                  h('h6', {class: 'q-my-none q-mr-sm'}, 'Invoice'),
                  icon(
                    'share',
                    'Share invoice',
                    () => {
                      state.share = s
                    },
                    {flat: true}
                  ),
                  icon('print', 'Print invoice', () => printInvoice(s), {
                    flat: true
                  })
                ])
              ]),
              h('div', {class: 'col-12 col-sm-6 invoice-heading'}, [
                h('div', {}, [h('b', {}, 'Invoice: '), s.id]),
                h('div', {}, [h('b', {}, 'Created at: '), date(s.time)])
              ])
            ],
            'q-pa-lg'
          )
        ])
      ]),
      h('div', {class: 'row q-col-gutter-md'}, [
        h('div', {class: 'col-12 col-md-6'}, [
          card(
            [
              section([
                h('p', {class: 'text-bold'}, 'Invoice'),
                details([
                  ['ID', s.id],
                  ['Created At', date(s.time)],
                  ['Status', h(Q.QBadge, {}, () => s.status)],
                  ['Total', money(s.total, s.currency)],
                  [
                    'Paid',
                    row([
                      h(
                        'span',
                        {class: 'q-mr-md'},
                        money(s.payments, s.currency)
                      ),
                      ...(s.status === 'open' && s.remaining > 0
                        ? [
                            btn('Pay Invoice', () => {
                              state.payAmount = {
                                value: amount(s.remaining, s.currency)
                              }
                            })
                          ]
                        : [])
                    ])
                  ]
                ])
              ])
            ],
            {class: 'full-height'}
          )
        ]),
        h('div', {class: 'col-12 col-md-6'}, [
          card(
            [
              section([
                h('p', {class: 'text-bold'}, 'Bill To'),
                details([
                  ['Company Name', s.company_name],
                  ['Name', `${s.first_name} ${s.last_name}`],
                  ['Address', s.address],
                  ['Email', s.email],
                  ['Phone', s.phone]
                ])
              ])
            ],
            {class: 'full-height'}
          )
        ])
      ]),
      card([
        section([
          h(Q.QTable, {
            flat: true,
            title: 'Items',
            rows: s.items.map((item, index) => ({...item, index})),
            rowKey: 'index',
            hidePagination: true,
            pagination: {rowsPerPage: 0},
            columns: [
              column('Item', 'description'),
              column('Amount', 'amount', v => amount(v, s.currency)),
              column('Qty', 'quantity'),
              {
                name: 'total',
                label: 'Total',
                field: i => amount(i.amount * i.quantity, s.currency),
                align: 'left'
              }
            ]
          })
        ])
      ]),
      h('div', {class: 'row'}, [
        h('div', {class: 'col-12 col-md-7'}, [
          card([
            section([
              h('p', {class: 'text-bold'}, 'Payments'),
              details([
                ['Date', h('b', {}, 'Amount')],
                ...(s.payment_history || []).map(p => [
                  date(p.time),
                  money(p.amount, s.currency)
                ])
              ])
            ])
          ])
        ])
      ])
    ])
  }
  function dialogs() {
    const share = state.share
    const ticket = state.ticket
    const deleting = state.deleting
    const p = state.payment
    const pay = state.payAmount
    return [
      editor(),
      dialog(
        share,
        () => {
          state.share = null
        },
        share
          ? [
              qr(shareUrl(share)),
              h('p', {class: 'break-all text-center q-mt-md'}, shareUrl(share)),
              row(
                [
                  flat('Copy URL', () => copy(shareUrl(share)), {
                    outline: true
                  }),
                  flat(
                    'Close',
                    () => {
                      state.share = null
                    },
                    {class: 'q-ml-auto'}
                  )
                ],
                'q-mt-lg'
              )
            ]
          : []
      ),
      dialog(
        ticket,
        () => {
          state.ticket = null
        },
        ticket
          ? [
              section([
                heading(`${ticket.name} sent a ticket`),
                h('small', {}, ticket.email),
                h('br'),
                h('small', {}, date(ticket.time))
              ]),
              h(Q.QSeparator),
              section([
                h('p', {class: 'ticket-content'}, ticket.ltext),
                ...(ticket.webhook_status !== 'not-configured'
                  ? [h('small', {}, `Webhook: ${ticket.webhook_status}`)]
                  : [])
              ]),
              row(
                [
                  flat(
                    'Close',
                    () => {
                      state.ticket = null
                    },
                    {color: 'primary'}
                  )
                ],
                'justify-end'
              )
            ]
          : []
      ),
      dialog(
        deleting,
        () => {
          state.deleting = null
        },
        deleting
          ? [
              heading(`Delete ${deleting.records ? 'ticket' : singular}?`),
              h(
                'p',
                {class: 'q-mt-md'},
                'Are you sure you want to delete this record?'
              ),
              dialogActions(
                btn(
                  'Delete',
                  async () => {
                    await api(
                      `/${deleting.records ? 'tickets' : noun}/${deleting.row.id}`,
                      'DELETE'
                    )
                    state.deleting = null
                    await loadList(deleting.records)
                  },
                  {color: 'pink'}
                ),
                () => {
                  state.deleting = null
                }
              )
            ]
          : []
      ),
      dialog(
        p,
        closePayment,
        p
          ? [
              qr(p.payment_request.toUpperCase()),
              h('p', {class: 'text-center q-mt-md'}, `${p.sats} sats`),
              h(
                'p',
                {class: 'text-center', role: 'status'},
                state.paymentStatus
              ),
              row(
                [
                  flat('Copy invoice', () => copy(p.payment_request), {
                    outline: true
                  }),
                  flat('Close', closePayment, {class: 'q-ml-auto'})
                ],
                'q-mt-lg'
              )
            ]
          : []
      ),
      dialog(
        pay,
        () => {
          state.payAmount = null
        },
        pay
          ? [
              h(
                Form,
                {
                  class: 'q-gutter-md',
                  onSubmit: () =>
                    run(() => {
                      const factor = state.public.currency === 'sats' ? 1 : 100
                      const famount = Math.round(Number(pay.value) * factor)
                      if (
                        !Number.isSafeInteger(famount) ||
                        famount <= 0 ||
                        Math.abs(Number(pay.value) * factor - famount) >
                          0.000001
                      )
                        throw new Error('Invalid payment amount.')
                      return startPayment({famount})
                    })
                },
                () => [
                  input('Payment Amount', pay, 'value', {
                    type: 'number',
                    min: state.public.currency === 'sats' ? 1 : 0.01,
                    step: state.public.currency === 'sats' ? 1 : 0.01,
                    suffix: state.public.currency
                  }),
                  dialogActions(
                    h(Q.QBtn, {
                      unelevated: true,
                      color: 'primary',
                      label: 'Create Payment',
                      type: 'submit',
                      loading: state.busy
                    }),
                    () => {
                      state.payAmount = null
                    }
                  )
                ]
              )
            ]
          : []
      )
    ]
  }
  function encodeLnurl(value) {
    const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
    const words = []
    let acc = 0,
      bits = 0
    for (const byte of new TextEncoder().encode(value)) {
      acc = (acc << 8) | byte
      bits += 8
      while (bits >= 5) {
        bits -= 5
        words.push((acc >>> bits) & 31)
      }
    }
    if (bits) words.push((acc << (5 - bits)) & 31)
    const hrp = 'lnurl'
    const expanded = [...hrp]
      .map(c => c.charCodeAt(0) >> 5)
      .concat(
        [0],
        [...hrp].map(c => c.charCodeAt(0) & 31)
      )
    let chk = 1
    for (const v of [...expanded, ...words, 0, 0, 0, 0, 0, 0]) {
      const top = chk >>> 25
      chk = ((chk & 0x1ffffff) << 5) ^ v
      ;[0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3].forEach(
        (g, i) => {
          if ((top >>> i) & 1) chk ^= g
        }
      )
    }
    chk ^= 1
    for (let i = 0; i < 6; i++) words.push((chk >>> (5 * (5 - i))) & 31)
    return hrp + '1' + words.map(n => alphabet[n]).join('')
  }
  function applyTheme(theme) {
    if (!theme || typeof theme.dark !== 'boolean') return
    Q.Dark.set(theme.dark)
    document.body.dataset.theme = /^[a-z0-9_-]{1,64}$/i.test(theme.name || '')
      ? theme.name
      : ''
    document.body.classList.toggle('gradient-bg', theme.gradient === true)
    for (const name of [
      'primary',
      'secondary',
      'accent',
      'positive',
      'negative',
      'info',
      'warning',
      'dark',
      'dark-page'
    ]) {
      const value = theme.colors?.[name]
      if (
        typeof value === 'string' &&
        value.length <= 128 &&
        CSS.supports('color', value)
      ) {
        document.body.style.setProperty(`--q-${name}`, value)
      } else {
        document.body.style.removeProperty(`--q-${name}`)
      }
    }
  }
  const app = Vue.createApp({
    render() {
      return h('div', {}, [
        state.error
          ? h(
              Q.QBanner,
              {class: 'bg-negative text-white q-mb-md', role: 'alert'},
              () => state.error
            )
          : null,
        !state.ready
          ? h('div', {class: 'text-center q-pa-xl', role: 'status'}, [
              h(Q.QSpinner, {size: '32px', color: 'primary'}),
              h('p', {}, 'Loading…')
            ])
          : state.context.public
            ? {
                lnticket: ticketPublic,
                eightball: eightballPublic,
                invoices: invoicePublic
              }[kind](state.public)
            : admin(),
        ...dialogs()
      ])
    }
  })
  app.use(Q)
  app.mount('#app')
  client.onThemeChange(applyTheme)
  run(async () => {
    state.context = await client.context()
    applyTheme(state.context.theme)
    if (state.context.public)
      state.public = await api(
        `/public/${encodeURIComponent(state.context.routeParams.id)}`
      )
    else {
      ;[state.wallets, state.currencies] = await Promise.all([
        api('/wallets'),
        api('/currencies')
      ])
      await refresh()
    }
    state.ready = true
  })
  window.addEventListener('pagehide', () => {
    clearTimeout(timer)
    client.close()
    app.unmount()
  })
})()
