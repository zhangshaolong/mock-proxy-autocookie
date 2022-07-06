const path = require('path')

const fs = require('fs')

const zlib = require('zlib')

const utilsTool = require('./utils')

const encoding = utilsTool.encoding

const cachedApis = {}

const slashReg = /^\/|\/$/g

const semReg = /\s*;\s*$/

const metaReg = /^\s*\/\*([\s\S]*?)\*\//m

const isMockDataReg = /^\s*(?:function|\{)/

const getMockDataFromFilePath = (apiPath, mockFilePath, params, request, response, options) => {
  const exist = fs.existsSync(mockFilePath)
  if (exist) {
    let mtime = fs.statSync(mockFilePath).mtime.getTime()
    let cachedApi = cachedApis[mockFilePath]
    if (!cachedApi || cachedApi.mtime !== mtime) {
      try {
        let content = new String(fs.readFileSync(mockFilePath, encoding), encoding).trim()
        // 支持在mock配置一些描述信息，实现对API生成接口文档
        let matched = true
        while (matched) {
          matched = false
          content = content.replace(metaReg, (all, contents) => {
            matched = true
            return ''
          })
        }
        content = content.replace(semReg, '') // 有的编辑器会自动在最后加上分号
        if (isMockDataReg.test(content)) {
          content = 'return (' + content + ')'
        }
        let result = Function(content)()
        cachedApis[mockFilePath] = cachedApi = {
          result,
          mtime
        }
      } catch (e) {
        try {
          const content = fs.readFileSync(mockFilePath, 'binary')
          return {
            writeHead: [200],
            output: [content, 'binary']
          }
        } catch (e) {
          return {
            writeHead: [500],
            output: [e.message, encoding],
            parser: JSON.stringify.bind(JSON)
          }
        }
      }
    }
    let result = cachedApi.result
    if (typeof result === 'function') {
      result = result(params, {
        require,
        request,
        response,
        __dirname: path.resolve(mockFilePath, '..'),
        tools: options.mockConfig && options.mockConfig.tools || {} // 后续可以进行mock的功能扩展，比如提供生成range数据等等
      })
    }
    const sleep = result.sleep
    if (!isNaN(sleep)) {
      try {
        let copy = JSON.parse(JSON.stringify(result))
        delete copy.sleep
        return {
          writeHead: [200, { 'Content-Type': 'text/plain;charset=' + encoding }],
          output: [copy, encoding],
          parser: JSON.stringify.bind(JSON),
          sleep: sleep
        }
      } catch (e) {
        return {
          writeHead: [200, { 'Content-Type': 'text/plain;charset=' + encoding }],
          output: [{
            code: 500,
            url: reqUrl,
            e: e
          },
          encoding],
          parser: JSON.stringify.bind(JSON)
        }
      }
    } else {
      return {
        writeHead: [200, { 'Content-Type': 'text/plain;charset=' + encoding }],
        output: [result, encoding],
        parser: JSON.stringify.bind(JSON)
      }
    }
  } else {
    if (options.mockConfig && options.mockConfig.fillMissingMock) {
      fillMissingMock(apiPath, null, options, params)
    }
    return {
      writeHead: [500],
      output: [mockFilePath + ' file is not existed~', encoding]
    }
  }
}

const getMockPath = (apiPath, options) => {
  let mockPath = (options.mockConfig && options.mockConfig.path) || 'mock'
  const rules = [].concat(options.rules)
  const len = rules.length
  let mockFilePath = apiPath
  for (let i = 0; i < len; i++) {
    let rule = new RegExp(rules[i])
    let isApi = false
    mockFilePath.replace(rule, (match) => {
      const parts = mockFilePath.replace(slashReg, '').split(/\//)
      mockFilePath = path.resolve(
        mockPath,
        parts.join('_')
      )
      isApi = true
    })
    if (isApi) {
      break
    }
  }
  mockFilePath += (options.mockConfig && options.mockConfig.ext) || '.js'
  return mockFilePath
}

const doMock = (apiPath, request, response, params, options) => {
  try {
    const mockFilePath = getMockPath(apiPath, options)
    const result = getMockDataFromFilePath(apiPath, mockFilePath, params, request, response, options)
    if (!isNaN(result.sleep)) {
      setTimeout(() => {
        response.writeHead.apply(response, result.writeHead)
        response.end.apply(response, result.output.map((item, idx) => {
          if (idx === 0) {
            if (result.parser) {
              return result.parser(item)
            }
          }
          return item
        }))
      }, result.sleep)
    } else {
      response.writeHead.apply(response, result.writeHead)
      response.end.apply(response, result.output.map((item, idx) => {
        if (idx === 0) {
          if (result.parser) {
            return result.parser(item)
          }
        }
        return item
      }))
    }
  } catch (e) {
    response.writeHead(500)
    response.end(JSON.stringify(e.message))
  }
}

const fillMissingMock = (apiPath, data, options, params) => {
  try {
    const mockFilePath = getMockPath(apiPath, options)
    if (!fs.existsSync(mockFilePath)) {
      let jsonStr;
      if (data) {
        const contentEncoding = data.headers['content-encoding']
        let decode = data.buffer
        if (contentEncoding === 'gzip') {
          decode = zlib.unzipSync(data.buffer)
        } else if (contentEncoding === 'br') {
          decode = zlib.brotliDecompressSync(data.buffer)
        }
        jsonStr = decode.toString()
      } else {
        if (options.mockConfig) {
          const fillMissingMock = options.mockConfig.fillMissingMock
          if (fillMissingMock) {
            const mockType = typeof fillMissingMock
            try {
              if (mockType === 'object') {
                jsonStr = JSON.stringify(fillMissingMock);
              } else if (mockType === 'function') {
                const result = fillMissingMock(apiPath, params)
                if (result instanceof Promise) {
                  result.then(json => {
                    jsonStr = JSON.stringify(json)
                    const response = JSON.stringify(JSON.parse(jsonStr), null, 2)
                    fs.mkdirSync(mockFilePath.replace(/\/[^/]+$/, ''), {recursive: true})
                    fs.writeFile(mockFilePath, response, {encoding, flags: 'w+'}, (e) => {
                      console.log(e)
                    })
                  })
                  return
                } else {
                  jsonStr = JSON.stringify(result)
                }
              } else {
                jsonStr = '{}'
              }
            } catch (e) {
              jsonStr = '{}'
            }
          }
        }
      }
      const response = JSON.stringify(JSON.parse(jsonStr), null, 2)
      fs.mkdirSync(mockFilePath.replace(/\/[^/]+$/, ''), {recursive: true})
      fs.writeFile(mockFilePath, response, {encoding, flags: 'w+'}, (e) => {
        console.log(e)
      })
    }
  } catch (e) {
    console.log(e)
  }
}

module.exports = {
  doMock,
  fillMissingMock
}