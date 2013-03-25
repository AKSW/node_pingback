var Pingback = require('./lib/pingback')
  , express = require('express')
  , EventEmitter = require('events').EventEmitter;


target = express();


target.use('/ping', function(req, res, next) {
    var ping = new Pingback(req, res);
    ping.on('fault', function(code, msg) {
      console.error(
        'Received bad pingback from '
        + this.source.href + '.'
        + ' Fault Code: ' + code
        + ' - Message: ' + msg
      );
    });
    ping.on('semantic_ping', function() {
      console.log('semantic_ping: Successful pingback :');
      console.log(this.excerpt);
    });

    ping.on('nonsemantic_ping', function() {
      console.log('nonsemantic_ping: Successful pingback :');
      console.log(this.excerpt);

    });

    ping.on('error', next);
    ping.on('end', function(source, target, next) {
      next();
    });
    req.pipe(ping);
});

target.use(function (err, req, res, next) {
    'use strict';
    console.log(err.stack || err);
});


target.listen(5000);

console.log('Pingserver running at http://127.0.0.1:5000/ping');

