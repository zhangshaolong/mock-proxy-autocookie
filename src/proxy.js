const http = require('http')

const https = require('https')

const URL = require('url')

const zlib = require('zlib')

const utilsTool = require('./utils')

const encoding = utilsTool.encoding

const pendings = {}

const cookiePairReg = /^([^=]+)=(.*)$/

const headerCharRegex = /[^\t\x20-\x7e\x80-\xff]/

const refreshQueryString = (queryStr, params) => {
  for (let ki in params) {
    let has = false
    let value = params[ki]
    queryStr = queryStr.replace(new RegExp('([?#&]' + ki + '=)([^&$]*)'), (all, k, v) => {
      has = true
      if (value === '') {
        return ''
      }
      return k + value
    })
    if (!has && value !== '') {
      queryStr += '&' + ki + '=' + value
    }
  }
  return queryStr.replace(/[?&]/, '?')
}

const showProxyLog = (options, method, redirectUrl, data) => {
  if (data.length > 2000) {
    console.log(
      `proxy request: \n\tHost:${options.host}\n\tPort:${options.port}\n\tMethod:${method}\n\tPath:${redirectUrl}\n\tParams:too large not display`
    )
  } else {
    console.log(
      `proxy request: \n\tHost:${options.host}\n\tPort:${options.port}\n\tMethod:${method}\n\tPath:${redirectUrl}\n\tParams:${data}`
    )
  }
}

const trimCookie = (val) => {
  return val.replace(/\s*HttpOnly[^;]*;?/ig, '').replace(/\s*Secure[^;]*;?/ig, '').replace(/\s*SameSite[^;]*;?/ig, '')
}

const flushQueues = (host, cookies) => {
  const {queues} = pendings[host]
  queues.forEach((resolve) => {
    resolve(cookies)
  })
}

const getProxyCookies = (host, chromeProfile) => {
  let pending = pendings[host]
  if (!pending) {
    pending = pendings[host] = {
      status: 'done',
      queues: []
    }
  }
  const {status, queues} = pending
  if (status === 'pending') {
    return new Promise((resolve) => {
      queues.push(resolve)
    })
  }
  return new Promise((resolve) => {
    const chrome = require('chrome-cookies-secure')
    try {
      pending.status = 'pending'
      chrome.getCookies(host, '', function(_, cookies = {}) {
        resolve(cookies)
        flushQueues(host, cookies)
        pending.status = 'done'
      }, chromeProfile)
    } catch (e) {
      resolve({})
      flushQueues(host, cookies)
      pending.status = 'done'
    }
  })
}

const proxyResponse = (proxyRes, res) => {
  let headers = proxyRes.headers
  try {
    if (headers) {
      for (let key in headers) {
        let val = headers[key]
        if (key.toLowerCase() === 'set-cookie') {
          if (Array.isArray(val)) {
            for (let i = 0; i < val.length; i++) {
              val[i] = trimCookie(val[i])
            }
          } else if (typeof val === 'string') {
            val = trimCookie(val)
          }
        }
        res.setHeader(key, val)
      }
    }
  } catch (e) {
    console.log('setHeader error', e.message)
  }
  return utilsTool.mergeData(proxyRes)
}

const getProxy = (request, proxyConfig) => {
  if (proxyConfig) {
    if (proxyConfig.host) {
      const excludes = proxyConfig.excludes
      if (excludes) {
        const pathname = URL.parse(request.url, true).pathname;
        for (let i = 0; i < excludes.length; i++) {
          const exclude = excludes[i]
          if (typeof exclude === 'function') {
            if (exclude(request, proxyConfig)) {
              return false
            }
          } else if (new RegExp(exclude).test(pathname)) {
            return false
          }
        }
      }
      return proxyConfig
    }
  }
  return false
}

const mergeCookie = (request, response, headers, params, method, isHttps, cookies, resolve, proxyConfig) => {
  let redirectUrl = request.url
  if (proxyConfig.redirect) {
    redirectUrl = proxyConfig.redirect(redirectUrl)
  }
  const mergedCookies = {}
  if (headers.cookie) {
    let cookieKv = headers.cookie.split(/\s*;\s*/)
    for (let i = 0; i < cookieKv.length; i++) {
      let cookiePair = cookiePairReg.exec(cookieKv[i])
      if (cookiePair) {
        mergedCookies[cookiePair[1]] = cookiePair[2]
      }
    }
  }
  for (let key in cookies) {
    mergedCookies[key] = cookies[key]
  }
  if (proxyConfig.headers) {
    const configCookieStr = proxyConfig.headers.cookie
    if (configCookieStr) {
      let cookieKv = configCookieStr.split(/\s*;\s*/)
      for (let i = 0; i < cookieKv.length; i++) {
        let cookiePair = cookiePairReg.exec(cookieKv[i])
        if (cookiePair) {
          mergedCookies[cookiePair[1]] = cookiePair[2]
        }
      }
    }
  }

  const mergedCookieArr = []
  for (let key in mergedCookies) {
    const val = mergedCookies[key]
    if (!headerCharRegex.test(val)) {
      mergedCookieArr.push(`${key}=${val}`)
    }
  }
  headers = { ...headers, ...proxyConfig.headers, cookie: mergedCookieArr.join(';') }

  let options = {
    host: proxyConfig.host,
    path: redirectUrl,
    method: request.method,
    headers: headers,
    timeout: proxyConfig.timeout || 30000,
    rejectUnauthorized: false,
    agent: false
  }
  if (proxyConfig.port) {
    options.port = proxyConfig.port
  }
  const beforeRequest = proxyConfig.beforeRequest
  if (beforeRequest) {
    try {
      let p = params;
      const isBuffer = Buffer.isBuffer(params)
      if (isBuffer) {
        p = params.toString()
      }
      p = JSON.parse(p)
      const extraData = beforeRequest(p, options)
      if (extraData) {
        const [extraParams = {}, extraOptions = {}] = extraData
        options = {...options, ...extraOptions}
        p = JSON.stringify({...p, ...extraParams})
        if (isBuffer) {
          p = Buffer.from(p)
          options.headers['content-length'] = p.length
        }
        params = p
        for (let key in extraParams) {
          options.path = refreshQueryString(options.path, extraParams)
          break;
        }
      }
    } catch (e) {
      console.log('beforeRequest called error', e)
    }
  }
  showProxyLog(proxyConfig, method, options.path, params)
  let proxyReq = (isHttps ? https : http)['request'](options, (proxyRes) => {
    proxyResponse(proxyRes, response).then(buffer => {
      let headers = response.getHeaders()
      if (proxyConfig.afterResponse) {
        try {
          buffer = proxyConfig.afterResponse(redirectUrl, utilsTool.getResponseStr({
            buffer,
            headers
          }), {
            request,
            response
          })
          const contentEncoding = headers['content-encoding']
          if (contentEncoding === 'gzip') {
            buffer = zlib.gzipSync(buffer)
          } else if (contentEncoding === 'br') {
            buffer = zlib.brotliCompressSync(buffer)
          }
          response.setHeader('content-length', buffer.length)
          headers = response.getHeaders()
        } catch (e) {}
      }
      response.writeHead(proxyRes.statusCode)
      response.end(buffer, encoding)
      resolve({
        buffer,
        headers
      })
    })
  })
  proxyReq.on('error', (e) => {
    response.end(
      JSON.stringify({
        status: 500,
        e: e.message
      })
    )
    console.log('proxyReq error: ' + e.message)
  })
  if (method === 'GET' || method === 'HEAD') {
    request.pipe(proxyReq)
  } else {
    proxyReq.end(params, encoding)
  }
}

const doProxy = (request, response, headers, params, method, proxyConfig, chromeProfile) => {
  const isHttps = proxyConfig.isHttps != null ? proxyConfig.isHttps : request.protocol === 'https'
  headers.host = proxyConfig.host + (proxyConfig.port ? ':' + proxyConfig.port : '')
  headers.connection = 'close'

  return new Promise((resolve) => {
    if (proxyConfig.autoCookie) {
      getProxyCookies(`http${isHttps? 's' : ''}://${headers.host}`, chromeProfile).then((cookies) => {
        mergeCookie(request, response, headers, params, method, isHttps, cookies, resolve, proxyConfig)
      })
    } else {
      mergeCookie(request, response, headers, params, method, isHttps, {}, resolve, proxyConfig)
    }
  })
}

module.exports = {
  doProxy,
  getProxy,
}