;(function (global) {
  'use strict'

  var CONNECT = 'lnbits-extension:connect'
  var CONNECTED = 'lnbits-extension:connected'
  var REQUEST = 'lnbits-extension:request'
  var RESPONSE = 'lnbits-extension:response'
  var EVENT = 'lnbits-extension:event'

  function messageError(value, fallback) {
    if (value instanceof Error) return value
    if (value && typeof value === 'object' && value.message)
      return new Error(String(value.message))
    return new Error(String(value || fallback || 'Extension request failed.'))
  }

  function cleanId(value, fallback) {
    var result = String(value || fallback || '')
    if (!result || result.length > 128)
      throw new Error('Invalid extension identifier.')
    return result
  }

  function Client(options) {
    options = options || {}
    this.extensionId = cleanId(options.extensionId, 'lnticketwasm')
    this.timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 15000
    this.port = null
    this.connectPromise = null
    this.requestId = 0
    this.pending = new Map()
    this.events = new Map()
    this.themeHandlers = new Set()
    this.subscriptionId = 0
  }

  Client.prototype.connect = function () {
    var self = this
    if (this.port) return Promise.resolve(this.port)
    if (this.connectPromise) return this.connectPromise
    if (
      typeof global.MessageChannel !== 'function' ||
      !global.parent ||
      !global.parent.postMessage
    ) {
      return Promise.reject(new Error('Extension bridge is unavailable.'))
    }
    this.connectPromise = new Promise(function (resolve, reject) {
      var channel = new global.MessageChannel()
      var port = channel.port1
      var id = self.nextId('connect')
      var timer = global.setTimeout(function () {
        try {
          port.close()
        } catch (_) {}
        self.connectPromise = null
        reject(new Error('Extension bridge connection timed out.'))
      }, self.timeout)
      var onMessage = function (event) {
        var message = event && event.data
        if (!message || message.type !== CONNECTED || message.id !== id) return
        global.clearTimeout(timer)
        port.removeEventListener('message', onMessage)
        self.port = port
        port.addEventListener('message', function (next) {
          self.receive(next && next.data)
        })
        port.start()
        self.connectPromise = null
        resolve(port)
      }
      port.addEventListener('message', onMessage)
      port.start()
      var origin
      try {
        origin = new URL(global.location.href).origin
      } catch (_) {
        origin = ''
      }
      if (!origin || origin === 'null') {
        global.clearTimeout(timer)
        port.close()
        self.connectPromise = null
        reject(new Error('Extension bridge origin is unavailable.'))
        return
      }
      global.parent.postMessage({type: CONNECT, id: id}, origin, [
        channel.port2
      ])
    })
    return this.connectPromise
  }

  Client.prototype.nextId = function (prefix) {
    this.requestId += 1
    return prefix + '-' + this.requestId + '-' + Date.now().toString(36)
  }

  Client.prototype.receive = function (message) {
    if (!message || typeof message !== 'object') return
    if (message.type === RESPONSE) {
      var pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      global.clearTimeout(pending.timer)
      if (message.ok === false)
        pending.reject(messageError(message.error, 'Extension request failed.'))
      else pending.resolve(message.data)
      return
    }
    if (message.type === EVENT) {
      if (message.event === 'ui.theme') {
        this.themeHandlers.forEach(function (handler) {
          handler(message.data)
        })
        return
      }
      var handlers = this.events.get(String(message.subscriptionId || '')) || []
      handlers.slice().forEach(function (handler) {
        handler(message)
      })
    }
  }

  Client.prototype.request = function (action, payload) {
    var self = this
    return this.connect().then(function (port) {
      return new Promise(function (resolve, reject) {
        var id = self.nextId('request')
        var timer = global.setTimeout(function () {
          self.pending.delete(id)
          reject(new Error('Extension request timed out.'))
        }, self.timeout)
        self.pending.set(id, {resolve: resolve, reject: reject, timer: timer})
        try {
          port.postMessage(
            Object.assign(
              {type: REQUEST, id: id, action: action},
              payload || {}
            )
          )
        } catch (error) {
          global.clearTimeout(timer)
          self.pending.delete(id)
          reject(messageError(error))
        }
      })
    })
  }

  Client.prototype.context = function () {
    return this.request('context')
  }

  Client.prototype.onThemeChange = function (handler) {
    if (typeof handler !== 'function')
      throw new Error('Theme handler must be a function.')
    this.themeHandlers.add(handler)
    var self = this
    return function () {
      self.themeHandlers.delete(handler)
    }
  }

  Client.prototype.api = function (method, path, body) {
    var self = this
    return this.request('api', {
      method: String(method || 'GET').toUpperCase(),
      path: path,
      body: body
    })
      .then(function (response) {
        while (
          response &&
          response.ok === true &&
          Object.prototype.hasOwnProperty.call(response, 'data')
        )
          response = response.data
        if (response && typeof response === 'object' && response.ok === false) {
          throw messageError(response.error, 'Extension API request failed.')
        }
        if (
          response &&
          typeof response === 'object' &&
          response.ok === true &&
          Object.prototype.hasOwnProperty.call(response, 'data')
        )
          return response.data
        return response
      })
      .catch(function (error) {
        throw messageError(error, 'Extension API request failed.')
      })
  }

  Client.prototype.notify = function (message, level) {
    return this.request('ui.notify', {
      message: String(message || ''),
      level: level || 'info'
    })
  }

  Client.prototype.notifyError = function (error) {
    return this.notify(messageError(error).message, 'negative')
  }

  Client.prototype.sessionGet = function (key) {
    return this.request('storage.session.get', {key: String(key || '')}).then(
      function (data) {
        return String((data && data.value) || '')
      }
    )
  }

  Client.prototype.sessionSet = function (key, value) {
    return this.request('storage.session.set', {
      key: String(key || ''),
      value: String(value || '')
    })
  }

  Client.prototype.replace = function (path) {
    return this.request('navigation.replace', {path: String(path || '')})
  }

  Client.prototype.openNewTab = function (url) {
    return this.request('navigation.open_new_tab', {url: String(url || '')})
  }

  Client.prototype.paymentSubscribe = function (paymentHash, handler) {
    var self = this
    var subscriptionId = this.nextId('payment')
    var list = this.events.get(subscriptionId) || []
    if (typeof handler === 'function') list.push(handler)
    this.events.set(subscriptionId, list)
    return this.request('payment.subscribe', {
      subscriptionId: subscriptionId,
      paymentHash: String(paymentHash || '')
    })
      .then(function () {
        return {
          subscriptionId: subscriptionId,
          unsubscribe: function () {
            return self.paymentUnsubscribe(subscriptionId)
          }
        }
      })
      .catch(function (error) {
        self.events.delete(subscriptionId)
        throw error
      })
  }

  Client.prototype.paymentUnsubscribe = function (subscriptionId) {
    this.events.delete(String(subscriptionId || ''))
    return this.request('payment.unsubscribe', {
      subscriptionId: String(subscriptionId || '')
    })
  }

  Client.prototype.close = function () {
    var self = this
    Array.from(this.pending.values()).forEach(function (pending) {
      global.clearTimeout(pending.timer)
      pending.reject(new Error('Extension bridge closed.'))
    })
    this.pending.clear()
    this.themeHandlers.clear()
    Array.from(this.events.keys()).forEach(function (id) {
      self.paymentUnsubscribe(id).catch(function () {})
    })
    if (this.port) {
      try {
        this.port.close()
      } catch (_) {}
    }
    this.port = null
    this.connectPromise = null
  }

  global.createLNbitsExtensionClient = function (options) {
    return new Client(options)
  }
})(window)
