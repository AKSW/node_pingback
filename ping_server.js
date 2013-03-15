/*global require, module, console */

var Pingback = require('./lib/pingback'),
    express = require('express');

var target = express();

target.use(target.router);

var ping = Pingback.middleware(function (source, target) {
    'use strict';
    console.log('Successful pingback from: ' + source.href);
    //console.log('Page title:', this.title);
    //console.log('Excerpt: ' + this.excerpt);
});

target.use('/ping', ping);
target.use(function (err, req, res, next) {
    'use strict';
    console.log(err.stack || err);
});

target.listen(5000);

console.log('Pingserver running at http://127.0.0.1:5000/ping');

