var http = require('http');
var fs = require('fs');

http.createServer(function (req, response) {
    fs.readFile('data/turtle_'+process.argv[2]+'.ttl', function(error, content) {
        if (error) {
            response.writeHead(500);
            response.end();
        }
        else {
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.end(content, 'utf-8');
        }
    });  

//res.writeHead(200, {'Content-Type': 'text/html'});
  //res.end('<a href="http://localhost:5000/">link</a>');
}).listen(4000);
console.log('Server running at http://127.0.0.1:4000/');
