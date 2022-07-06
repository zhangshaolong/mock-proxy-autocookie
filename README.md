# mock-proxy-autocookie

前后端分离项目中的本地mock及远程代理

install
```shell
npm install mock-proxy-autocookie --save-dev
```

```javascript
var mockProxy = require('mock-proxy-autocookie')
```

define config /xxx/config.js
```javascript
module.exports = [
  {
    rules: ['^/api/', ^/common-api/], // array，typeof string or regexp
    rules: '^/api/', // string or regexp
    proxyConfig: {
      host: '12.12.12.12',
      port: 8080,
      autoCookie: false, // set true for auto proxy cookie, need project install chrome-cookies-secure
      isHttps: false, // default the same with original
      timeout: 30000, // ms, default 30000ms
      headers: { // set custom headers to proxy server, default proxy original headers
        cookie: 'xxxx'
      },
      redirect: (path) => { // could config redirect path for remote api
        return path
      },
      excludes: [ // when use proxy mode, this apis use local mode
        '^/api/get_index_data/', // string
        /^\/api\/user_info/, // regexp
        (request, proxyConfig) => { // function
          return request.headers.xxx === '/xxxx/' // any logic
        }
      ],
      fillMissingMock: false, // fill missing mock file when lost
      beforeRequest: (params, options) => {
        return [
          {
            _token: 'xxxxx', // add some extra params or reset key:value in params
          },
          {
            agent: false, // set some extra options for nodejs http(s).request`s options
            auth: 'xxxx'
          }
        ]
      }
    },
    mockConfig: {
      path: 'mock', // project`s mock dir name， default 'mock'
      ext: '.js',
      fillMissingMock: boolean || object || (apiPath, params) => (promise<object> | object)
    }
  }
]
```
if you use express server, you can use it like here:
```javascript
var app = express()
var config = require('/xxx/config')

app.use(mockProxy(config));

app.use(mockProxy(
  '/xxx/config.js' // if set the config path as first param，the change is immediate effect when modify config
));

app.use(mockProxy(
  config,
  '/xxx/xxx/personal_path_config.js' // optional，prevent modification conflicts, could set the second param as self config, add this config file to .gitignore file
));

app.use(mockProxy(
  '/xxx/config.js',
  '/xxx/personal_path_config.js'
));
```

for example，a api like '/common-api/get_user_info', you can define a js file at
${project}/mock/common-api/get_user_info.js, it`s content like

```javascript
function (params) {
    return {
        err_no: 0,
        err_msg: '',
        sleep: 1000, // mock 1 second delay
        data: {
            name: 'zhangsan'
        }
    }
}
```
or
```javascript
{
    err_no: 0,
    err_msg: '',
    data: {
        name: 'zhangsan'
    }
}
```
if you want to cache mock status by context, you can do it like this:

```javascript
let times = 0
return function (params) { // this 'return' is required
  return {
    code: xxx,
    data: {
      times: times++ // this can cache prev value
    }
  }
}
```
for example another, a api like '/api/a/b/c', you can define a js file at
${project}/mock/api/a_b_c.js
if you use gulp-connect server, you can use it like here:

```javascript
var connect = require('gulp-connect');
var config = require('/xxx/config');
connect.server({
    host: host,
    port: port,
    root: ['/'],
    middleware: function(connect, opt) {
        return [
            mockProxy(config || '/xxx/config')  // if set a path of config, config is immediate effect
        ];
    }
});
```
if you use webpack-dev-server, you can use it like here on webpack.config.js:

```javascript
var config = require('/xxx/config');
devServer: {
  contentBase: '/dist',
  port: 8888,
  historyApiFallback: true,
  inline: true,
  before: function(app) {
    app.use(mockProxy(config || '/xxx/config')) // if set a path of config, config is immediate effect
  }
}
```
if you look at all of apis at this project, input 'https?:{host}/show-apis', need has mock file and meta about api description

