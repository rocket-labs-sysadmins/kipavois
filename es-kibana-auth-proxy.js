var http = require('http'),
    connect = require('connect'),
    bodyParser = require('body-parser'),
    httpProxy = require('http-proxy');

module.exports = function(options) {
    var kibanaUserHeader = options.kibanaUserHeader || 'x-kibana-user',
        elasticsearchEndpoint = options.elasticsearchEndpoint || 'elasticsearch:9200',
        port = options.port || 9200,
        proxy = httpProxy.createProxyServer({
            target: 'http://' + elasticsearchEndpoint
        }),
        app = connect()
            // consume body
            .use(bodyParser.json())
            // transform body
            .use(function(req, res){
              req.body['plop'] = 'pouet'
              newBody = JSON.stringify(req.body)
              req.headers['content-length'] = newBody.length
              // configure pipes
              proxy.web(req, res)
              // emit new body from upstream
              req.emit('data', newBody)
        });
    var start_proxy = function() {
      http.createServer(app).listen(port, function(){
        console.log('proxy listen ' + port);
      });
    }

    return {
      start_proxy: start_proxy
    }
}
