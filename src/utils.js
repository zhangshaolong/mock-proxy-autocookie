const queryString = require('querystring')
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')

const metaReg = /^\s*\/\*([\s\S]*?)\*\//m
const docKeyReg = /^[\s\*]*@(path|method|params|desc|type|headers)\s*([\s\S]+)$/gi
const descReg = /^\s*((["'])([^\2]+)\2|([^\s]+))\s*:\s*((['"])[^\6]+\6|[\s\S]*\/\/([^$]+))$/

const encoding = 'UTF-8'

const mergeData = (original) => {
  return new Promise((resolve) => {
    let chunks = []
    let size = 0
    original.on('data', (chunk) => {
      chunks.push(chunk)
      size += chunk.length
    })
    original.on('end', () => {
      let data = null
      let len = chunks.length
      switch (len) {
        case 0:
          data = Buffer.alloc(0)
          break
        case 1:
          data = chunks[0]
          break
        default:
          data = Buffer.alloc(size)
          for (let i = 0, pos = 0; i < len; i++) {
            let chunk = chunks[i]
            chunk.copy(data, pos)
            pos += chunk.length
          }
          break
      }
      resolve(data)
    })
  })
}

const getApiConfig = (apiPath, cfgs) => {
  for (let i = 0; i < cfgs.length; i++) {
    const rules = [].concat(cfgs[i].rules)
    for (let j = 0; j < rules.length; j++) {
      if (new RegExp(rules[j]).test(apiPath)) {
        return cfgs[i]
      }
    }
  }
  return false
}

const getParams = (request, query, method, isFormData, isProxy) => {
  if (method === 'GET' || method === 'HEAD') {
    return Promise.resolve(isProxy ? JSON.stringify(query) : query)
  } else {
    let bodyData = request.body
    if (bodyData) {
      return Promise.resolve([isFormData ? queryString : JSON][isProxy ? 'stringify' : 'parse'](bodyData))
    } else {
      return mergeData(request).then((data) => {
        if (!isProxy) {
          if (data.length) {
            data = (isFormData ? queryString : JSON).parse(data.toString())
          }
        }
        return data
      })
    }
  }
}

const parseMeta = (data) => {
  const meta = {
    method: 'get',
    type: 'json'
  }
  let dt = data
  let matched = true
  while (matched) {
    matched = false
    dt = dt.replace(metaReg, (all, contents) => {
      matched = true
      let lines = contents.split(/\n/)
      let paramsMap = {}
      let hasParamMap = false
      lines.forEach((line) => {
        line.replace(docKeyReg, (str, type, val) => {
          if (type === 'params') {
            if (/^\.([^\s]+)/.test(val)) {
              let key = RegExp.$1
              let columns = val.replace(/^\.([^\s]+)/, '').split(/\s*,\s*/)
              if (columns.length > 3) {
                columns[2] = columns.slice(2).join(',')
                columns.length = 3
              }
              paramsMap[key] = columns
              hasParamMap = true
              return
            }
          }
          meta[type] = val
        })
      })
      if (hasParamMap) {
        meta.paramsMap = paramsMap
      }
      return ''
    })
  }
  let respDescMap = {}
  dt.split(/\n/).forEach((line) => {
    if (descReg.test(line)) {
      if (RegExp.$7) {
        respDescMap[RegExp.$3 || RegExp.$4] = RegExp.$7
      }
    }
  })
  meta.respDescMap = respDescMap
  return meta
}

const findAPIs = (mockPath) => {
  let apis = []
  if (fs.existsSync(mockPath) && fs.statSync(mockPath).isDirectory()) {
    fs.readdirSync(mockPath).forEach((fileName) => {
      let data = fs.readFileSync(path.join(mockPath, fileName), 'utf8')
      if (data) {
        const parsed = parseMeta(data)
        parsed.path && apis.push(parsed)
      }
    })
  }
  return apis
}

const getApiDocData = (configs) => {
  let totalApis = []
  const set = new Set();
  configs.forEach((config) => {
    let mockConfig = config.mockConfig
    if (mockConfig) {
      let mockPath = mockConfig.path
      if (!set.has(mockPath)) {
        set.add(mockPath)
        let apis = findAPIs(path.resolve(mockPath))
        totalApis.push({
          mockPath,
          apis
        })
      }
    }
  })
  return totalApis
}

const getResponseStr = (data) => {
  if (data) {
    const contentEncoding = data.headers['content-encoding']
    let decode = data.buffer
    if (contentEncoding === 'gzip') {
      decode = zlib.unzipSync(data.buffer)
    } else if (contentEncoding === 'br') {
      decode = zlib.brotliDecompressSync(data.buffer)
    }
    return decode.toString()
  }
}

module.exports = {
  encoding,
  mergeData,
  getApiConfig,
  getParams,
  getApiDocData,
  getResponseStr
}