var http = require('http'),
    bodyParser = require('body-parser'),
    connect = require('connect'),
    fs = require('fs'),
    httpProxy = require('http-proxy'),
    Type = require('type-of-is'),
    winston = require('winston');
require('prototypes');

module.exports = function(options) {
    var kibanaUserHeader = options.kibanaUserHeader || 'x-kibana-user',
        kibanaUserHeaderRegex = options.kibanaUserHeaderRegex || '([^,]+),?',
        kibanaUserField = options.kibanaUserField || 'user',
        elasticsearchEndpoint = options.elasticsearchEndpoint || 'elasticsearch:9200',
        listenPort = options.listenPort || 8000,
        proxy = httpProxy.createProxyServer({
            target: 'http://' + elasticsearchEndpoint
        }),
        logger = new (winston.Logger)({
          transports: [
            new (winston.transports.Console)()
          ]
        }),
        parse_msearch = function(raw, onError) {
          query = null;
          queries = [];
          lines = raw.split('\n');
          for (var i = 0 ; i < lines.length ; i++) {
            if (lines[i].length === 0) {
              continue;
            }
            if (query == null) {
              try {
                query = JSON.parse(lines[i]);
              } catch (e) {
                onError(e, "parsing query indices: " + escape(lines[i]))
              }
            } else {
              try {
                body = JSON.parse(lines[i])
              } catch (e) {
                onError(e, "parsing query" + escape(lines[i]))
              }
              queries.push({
                'query': query,
                'body': body
              });
              query = null;
            }
          }
          return queries;
        },
        add_term_filter_msearch = function(q, term, value, onError) {
          query = q.body.query;
          logger.debug("Query: " + JSON.stringify(query))
          if (query == undefined) {
            return onError('No "query" field in body');
          }
          bool_filter = query.bool;
          if (bool_filter == undefined) {
            return onError('No "bool" field in body.query.filtered.bool')
          }
          if (bool_filter.should == undefined) {
            bool_filter.should = []
          } else if (!Type.is(bool_filter.should, Array)) {
            bool_filter.should = [bool_filter.should]
          }
          for (var i = 0; i < value.length; i++){
            if (value.length > 0) {
              var newTerm = {}
              newTerm[term] = value[i]
              bool_filter.should.push({
                'term': newTerm
              })
            }
          }
          // we need to make sure that at least one "should" parameter does apply
          // if any value is present
          if (bool_filter.should.length > 0) {
            if (bool_filter.minimum_should_match == undefined){
                bool_filter.minimum_should_match = 1
            }
          }
        },
        app = connect()
            .use(function(req, res, next) {
              logger.debug(req.method + " " + req.url)
              //logger.info("Headers: " + JSON.stringify(req.headers) + " with method: " + req.method + " for URL: " + req.url)
              if (kibanaUserHeader in req.headers) {
                if (req.method == 'POST') {
                  if (req.url.startsWith('/_msearch')) {
                    // launch body rewrite
                    next();
                  } else if (req.url.startsWith('/.kibana/config') && req.url.endsWith('_update')) {
                    // non admin user is not allowed to modify the .kibana index
                    res.statusCode = 403
                    res.end()
                  } else if (req.url.startsWith('/.kibana/dashboard/') && req.url.endsWith('op_type=create')) {
                    // Cannot create or update a dashboard
                    res.statusCode = 403
                    res.end()
                  } else {
                    proxy.web(req, res, function(e) {
                      logger.error(e)
                      res.statusCode = 500
                      res.end();
                    });
                  }
                } else if (req.method == 'DELETE') {
                  // Objects cannot be deleted
                  res.statusCode = 403
                  res.end()
                } else {
                  proxy.web(req, res, function(e) {
                    logger.error(e)
                    res.statusCode = 500
                    res.end();
                  });
                }
              } else {
                proxy.web(req, res, function(e) {
                  logger.error(e)
                  res.statusCode = 500
                  res.end();
                });
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
              queries = parse_msearch(req.body, function(message, context) {
                logger.error(message, {
                  method: req.method,
                  url: req.url,
                  body: req.body,
                  context: context
                })
              })
              newBody = ""
              queries.forEach(function(q) {
                try {
                  allowedTerms = JSON.parse(req.headers[kibanaUserHeader]);
                } catch (e) {
                  var kibanaUserHeaderValue = req.headers[kibanaUserHeader];
                  allowedTerms = []
                  var re = new RegExp(kibanaUserHeaderRegex, 'gmi');
                  var result = [];
                  while((result = re.exec(kibanaUserHeaderValue)) != null) {
                    allowedTerms.push(result[1]);
                  }
                }
                add_term_filter_msearch(q, kibanaUserField, allowedTerms, function(message) {
                  logger.error(message, {
                    method: req.method,
                    url: req.url,
                    body: req.body
                  })
                })
                newBody += JSON.stringify(q.query)
                newBody += '\n'
                newBody += JSON.stringify(q.body)
                newBody += '\n'
              });
              logger.info("new body: " + newBody)
              req.headers['content-length'] = newBody.length
              next()
            })
            // configure proxy pipelines and emit the new body
            .use(function(req, res) {
              proxy.web(req, res, function(e) {
                logger.error("Error during new body sending: " + e)
                res.statusCode = 500
                res.end();
              })
              req.emit('data', newBody)
            });
    var start_proxy = function() {
      logger.info('kibanaUserHeader: ' + kibanaUserHeader);
      logger.info('kibanaUserHeaderRegex: ' + kibanaUserHeaderRegex);
      logger.info('kibanaUserField: ' + kibanaUserField);
      logger.info('elasticsearchEndpoint: ' + elasticsearchEndpoint);
      logger.info('listenPort: ' + listenPort);

      http.createServer(app).listen(listenPort, function(){
        console.log('proxy listen ' + listenPort);
      });
    }

    return {
      start_proxy: start_proxy,
      parse_msearch: parse_msearch,
      add_term_filter_msearch: add_term_filter_msearch
    }
}
