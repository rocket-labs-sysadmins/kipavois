var http = require('http'),
    connect = require('connect'),
    bodyParser = require('body-parser'),
    httpProxy = require('http-proxy'),
    Type = require('type-of-is');
    fs = require('fs');
require('prototypes');

module.exports = function(options) {
    var kibanaUserHeader = options.kibanaUserHeader || 'x-kibana-user',
        kibanaUserField = options.kibanaUserField || 'user',
        elasticsearchEndpoint = options.elasticsearchEndpoint || 'elasticsearch:9200',
        port = options.port || 9200,
        proxy = httpProxy.createProxyServer({
            target: 'http://' + elasticsearchEndpoint
        }),
        parse_msearch = function(raw) {
          query = null;
          queries = [];
          lines = raw.split('\n');
          for (var i = 0 ; i < lines.length ; i++) {
            if (query == null) {
              query = JSON.parse(lines[i]);
            } else {
              queries.push({
                'query': query,
                'body': JSON.parse(lines[i])
              });
              query = null;
            }
          }
          return queries;
        },
        add_term_filter_msearch = function(q, term, value, onError) {
          query = q.body.query;
          if (query == undefined) {
            return onError('No "query" field in body');
          }
          filtered = query.filtered;
          if (filtered == undefined) {
            return onError('No "filtered" field in body.query');
          }
          filter = filtered.filter;
          if (filter == undefined) {
            return onError('No "filter" field in body.query.filtered');
          }
          bool_filter = filter.bool;
          if (bool_filter == undefined) {
            return onError('No "bool" field in body.query.filtered.bool')
          }
          if (bool_filter.must == undefined) {
            bool_filter.must = []
          } else if (!Type.is(bool_filter.must, Array)) {
            bool_filter.must = [bool_filter.must]
          }
          var newTerm = {}
          newTerm[term] = value
          bool_filter.must.push({
            'term': newTerm
          })
        },
        app = connect()
            // only rewrite body of the 'POST /_msearch' operation
            .use(function(req, res, next) {
              if (req.method == 'POST' &&
                  req.url.startsWith('/_msearch') &&
                  kibanaUserHeader in req.headers) {
                next();
              } else {
                proxy.web(req, res);
              }
            })
            .use(function(req, res, next) {
              if (!('content-type' in req.headers)) {
                req.headers['content-type'] = 'text/plain'
              }
              next()
            })
            // consume body
            .use(bodyParser.text({type: '*/*'}))
            // rewrite body
            .use(function(req, res, next){
              if (!(Type.is(req.body, String))) {
                req.body = ""
              }
              queries = parse_msearch(req.body)
              newBody = ""
              queries.forEach(function(q) {
                add_term_filter_msearch(q, kibanaUserField, req.headers[kibanaUserHeader], function(message) {
                  console.error(message)
                  //fs.appendFile("/var/log/pavois.log", "Error: " + message + ": " + req.method + " " + req.url + '\n' + req.body + '\n==================================================\n', function(err, data){})
                })
                newBody += JSON.stringify(q.query)
                newBody += '\n'
                newBody += JSON.stringify(q.body)
                newBody += '\n'
              });
              req.headers['content-length'] = newBody.length
              next()
            })
            // configure proxy pipelines and emit the new body
            .use(function(req, res) {
              proxy.web(req, res)
              req.emit('data', newBody)
            });
    var start_proxy = function() {
      http.createServer(app).listen(port, function(){
        console.log('proxy listen ' + port);
      });
    }

    return {
      start_proxy: start_proxy,
      parse_msearch: parse_msearch,
      add_term_filter_msearch: add_term_filter_msearch
    }
}
