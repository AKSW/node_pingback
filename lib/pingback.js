/**
 * Pingback (https://github.com/chjj/pingback)
 * Pingbacks for node.js.
 * Copyright (c) 2011, Christopher Jeffrey. (MIT Licensed)
 */

var http = require('follow-redirects').http
  , raptor = require('raptor')
  , parse = require('url').parse
  , EventEmitter = require('events').EventEmitter
  , StringDecoder = require('string_decoder').StringDecoder;

var $attempted = []
  , $recorded = [];

/**
 * Pingback
 */

var Pingback = function(req, res, body) {
  if (!(this instanceof Pingback)) {
    return new Pingback(req, res, body);
  }

  EventEmitter.call(this);

  this.readable = true;
  this.writable = true;

  this.req = req;
  this.res = res;
  this.body = body = body || req.rawBody || req.body;
  this.source = this.target = {};

  if (body == null) {
    if (!this.req.readable) {
      return this.emit('error', new Error('No body.'));
    }
  } else {
    // give time for the event listeners to be bound
    var self = this;
    process.nextTick(function() {
      self._handle();
    });
  }
};

Pingback.prototype.__proto__ = EventEmitter.prototype;

/**
 * Receiving Pingbacks
 */

// fault code constants
Pingback.METHOD_NOT_FOUND = -32601;
Pingback.GENERAL_ERROR = 0;
Pingback.SOURCE_DOES_NOT_EXIST = 16;
Pingback.NO_LINK_TO_TARGET = 17;
Pingback.TARGET_DOES_NOT_EXIST = 32;
Pingback.TARGET_CANNOT_BE_USED = 33;
Pingback.ALREADY_REGISTERED = 48;
Pingback.ACCESS_DENIED = 49;

Pingback.prototype._fault = (function() {
  var faults = {
    '-32601': 'Requested method not found.',
         '0': 'Error.',
        '16': 'The source does not exist.',
        '17': 'The source does not contain a link to the target.',
        '32': 'The specified target does not exist.',
        '33': 'The specified target cannot be used as a target.',
        '48': 'The pingback has already been registered.',
        '49': 'Access denied.'
  };

  var xml = [
    '<?xml version="1.0"?>',
    '<methodResponse>',
    '  <fault><value><struct>',
    '    <member>',
    '      <name>faultCode</name>',
    '      <value><int>__CODE__</int></value>',
    '    </member>',
    '    <member>',
    '      <name>faultString</name>',
    '      <value><string>__FAULT__</string></value>',
    '    </member>',
    '  </struct></value></fault>',
    '</methodResponse>'
  ].join('\n');

  return function(code) {
    var body = xml
      .replace('__CODE__', code)
      .replace('__FAULT__', faults[code]);

    this.res.statusCode = 400;
    this.res.setHeader('Content-Length', Buffer.byteLength(body));
    this.res.end(body);

    this.emit('fault', code, faults[code]);
    this.destroy();
  };
})();

Pingback.prototype._success = (function() {
  var xml = [
    '<?xml version="1.0"?>',
    '<methodResponse>',
    '  <params><param>',
    '    <value><string>__MESSAGE__</string></value>',
    '  </param></params>',
    '</methodResponse>'
  ].join('\n');

  return function(msg, emit) {
    var body = xml.replace('__MESSAGE__', msg);
    this.res.statusCode = 200;
    this.res.setHeader('Content-Length', Buffer.byteLength(body));
    this.res.end(body);
    this.destroy();
  };
})();

Pingback.prototype.write = function(data) {
  if (Buffer.isBuffer(data)) {
    if (!this._decode) {
      this._decode = new StringDecoder('utf8');
    }
    data = this._decode.write(data);
  }

  // buffer the body
  this.body += data;

  // a pingback should *not* be more than 5kb
  if (this.body.length > 5 * 1024) {
    this.req.destroy();
    this._fault(Pingback.GENERAL_ERROR);
  }
};

Pingback.prototype.end = function(data) {
  if (data) this.write(data);
  this._handle();
};

Pingback.prototype.destroy = function() {
  this.readable = false;
  this.writable = false;
  this.destroyed = true;
};

// finds xmlrpc parameters
var param = new RegExp(
  '<param>\\s*<value>\\s*(?:<string>\\s*)?'
  + '(?:<!\\[CDATA\\[)?([^<>]+?)(?:\\]\\]>)?'
  + '(?:\\s*</string>)?\\s*</value>\\s*</param>',
'gi');

Pingback.prototype._handle = function() {
  var self = this
    , body = this.body
    , type = this.req.headers['content-type']
    , uri = [];

  // the xml-rpc spec says to use text/xml,
  // but then again, that was from a long time ago
  this.res.setHeader('Content-Type', 'application/xml; charset=utf-8');

  // make sure the request is a pingback
  if (!type || !body || typeof body !== 'string') {
    return this._fault(Pingback.GENERAL_ERROR);
  }

  type = type.split(';')[0].trim();
  if (type.slice(-3) !== 'xml') {
    return this._fault(Pingback.GENERAL_ERROR);
  }

  // <methodName/>
  if (!~body.indexOf('pingback.ping')) {
    return this._fault(Pingback.METHOD_NOT_FOUND);
  }

  // look for the uri's with a regex
  body.replace(param, function($0, $1) {
    uri.push($1.replace(/&amp;/gi, '&').trim());
  });

  // grab the uri's
  var source = this.source = uri[0] && parse(uri[0])
    , target = this.target = uri[1] && parse(uri[1]);

  // make sure the URIs are there
  if (!source || !target) {
    return this._fault(Pingback.SOURCE_DOES_NOT_EXIST);
  }

  // make sure they're not the same
  //if (source.host === target.host) {
    //console.log('source=target');
  //  return this._fault(Pingback.TARGET_CANNOT_BE_USED);
  //}

  // check to make sure the uri's are valid urls
  if (!source.host) {
    return this._fault(Pingback.SOURCE_DOES_NOT_EXIST);
  }

  // the target id will either be in the path or query string
  if (!target.host || (!target.pathname && !target.query)) {
    //console.log('targetid');
    return this._fault(Pingback.TARGET_CANNOT_BE_USED);
  }

  // make sure there is a potential post id
  /*if (target.pathname.length < 2 
      && (!target.query || !target.query.length)) {
    console.log('postid');
    console.log(target.pathname);
    console.log(!target.query+'\n');
    return this._fault(Pingback.TARGET_CANNOT_BE_USED);
  }*/

  // make sure it hasnt been recorded
  if (~$recorded.indexOf(source.href)) {
    return this._fault(Pingback.ALREADY_REGISTERED);
  }

  // make sure people arent spamming the server
  if (~$attempted.indexOf(source.href)) {
    // use 49 for access denied, because
    // it wasnt necessarily registered/recorded
    return this._fault(Pingback.ACCESS_DENIED);
  }

  // these should probably be objects instead
  if ($attempted.length > 200) $attempted = [];
  if ($recorded.length > 200) $recorded = [];

  // validate the pingback here if `ping` is bound
  if (this.listeners('ping').length > 0) {
    this.emit('ping', source, target, function(err) {
      if (err != null) return self._fault(err);
      self._pass();
    });
  } else {
    this._pass();
  }

  $attempted.push(source.href);
};

var check_html = function(source, target, body, self)
{
  
  // get the title of the page
  var title = body.match(/<title>([^<]+)<\/title>/i);
  if (title) title = title[1].trim();

  if (!title || title.length > 150) {
    title = source.hostname;
  }

  // make sure the link to the target uri actually
  // exists on the page and grab an excerpt
  if (!~body.indexOf(target.href)) {
    self._fault(Pingback.NO_LINK_TO_TARGET);
    return false;
  }

  // replace the link with placeholder tags to
  // mark its position, then remove all markup
  body = body.replace(/##/g, '');
  body = body.replace(RegExp('<a[^>]+'
        + target.href.replace(/([.?+()])/g, '\\$1')
        + '[^>]+>([\\s\\S]+?)</a>', 'gi'
        ), '##$1##'
      );

  // remove all markup
  body = body.replace(/<[^>]+>|&[^\s]+;/g, '');

  // find the link again and grab 10 words on each side of it
  var excerpt = body.match(
      /((?:[^\s]+\s+){0,10})##([\s\S]+?)##((?:\s+[^\s]+){0,10})/
      );

  if (!excerpt) {
    self._fault(Pingback.NO_LINK_TO_TARGET);
    return false;
  }

  // put the excerpt together, make sure
  // its not more than 300 characters long
  excerpt = excerpt.slice(1).join(' ');

  self.title = title; 
  self.excerpt = excerpt.replace(/\s+/g, ' ')
    .substring(0, 300).trim();

  return true;
}

var check_rdf  = function(parser_name, source, target, body, self)
{	
  //create turtle-/rdfxml-/rdfa- parser 
  parser = raptor.newParser(parser_name);
  var tripleCount = 0;
  var result = -1; 
  var parsing_done = false; 
  parser.on('statement', function (statement) {
    //subject == source and object == target?
    if ((statement.subject.value.toLowerCase() == source.href.toLowerCase())
        && (statement.object.value.toLowerCase() == target.href.toLowerCase()))
    {
      //success!
      result = 0;
    }

    //subject == target and object == source?
    if ((statement.object.value.toLowerCase() == source.href.toLowerCase())
        && (statement.subject.value.toLowerCase() == target.href.toLowerCase()))
    {
      //success!
      result = 0;
    }
    
    //triple found
    tripleCount++;

    //source and target found AND parsing not done (workaround for nonfunctioning parser.abort)
    if ((result == 0) && (!parsing_done))
    {
      //Save triple
      self.excerpt = statement;
      
      //workaround variable
      parsing_done = true;
      
      parser.abort();
    }
  });

  parser.on('end', function () {
    //source and target not found and no triples parsed
    if ((result == -1) && (tripleCount == 0))
      result = -2;
  });

  //start parsing
  parser.parseStart(source.host);
  parser.parseBuffer(new Buffer(body));
  parser.parseBuffer();
  return result;
}


//check source for pingback
Pingback.prototype._pass = function() {
  var self = this
    , source = this.source
    , target = this.target;
  
  //used linked data parsers (in this order)
  var linked_data_parser = {
    turtle: 'turtle',
    rdfxml: 'rdfxml',
    rdfa: 'rdfa'

  };
 
  // make sure the source uri exists and
  // retreive the text of the page
  request(source, function(err, res) {
    //body not empty
    var body = res && res.body;
    if (err || !body) {
      return self._fault(Pingback.SOURCE_DOES_NOT_EXIST);
    }

    //init vars
    self.excerpt = '';
    self.title = ''; 
    var pingback_successful = false;
    var do_html_check = false;
    var is_semantic_ping = false;

    //parse body with linked data parsers
    for(var parser in linked_data_parser)
    {
      //console.log(linked_data_parser[parser]); 
      rdf_check_result = check_rdf(linked_data_parser[parser], source, target, body, self); 
      switch (rdf_check_result)
      { 
        case 0: //Triples found; source and target in relation 
          do_html_check = false;
          pingback_successful = true;
          is_semantic_ping = true;
          break;
        
        case -1: //Triples found; source and target not in relation
          do_html_check = false;
          pingback_successful = false;
          self._fault(Pingback.NO_LINK_TO_TARGET);
          break;

        default: //No Triples found
          do_html_check = true;
          pingback_successful = false;
          break;
      }

      //source and target found? -> end loop 
      if (pingback_successful) break;
    }

    //parsing not successful; try plain html check
    if (do_html_check)
      pingback_successful = check_html(source, target, body, self);
    

    if (pingback_successful)
    {
      if (self.listeners('ping').length > 0) {
        self._success('Pingback successful.');
        self.emit('success', source, target);
      } else {
        self.emit('end', source, target, function(err) {
          if (err != null) return self._fault(err);
          self._success('Pingback successful.');
        });
      }
      
      if (is_semantic_ping)
        self.emit('semantic_ping');
      else
        self.emit('nonsemantic_ping');

      $recorded.push(source.href);
    }
 

  });
 
 };

/**
 * HTTP Request
 */

// make an http request
var request = function(url, body, func) {
  if (typeof url !== 'object') {
    url = parse(url);
  }

  if (!func) {
    func = body;
    body = undefined;
  }

  var opt = {
    host: url.hostname,
    port: url.port || 80,
    path: url.pathname
    //agent: false
  };

  if (body) {
    opt.headers = {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Range': 'bytes=0-5120'
    };
    opt.method = 'POST';
  } else {
    opt.headers = {
      'Accept': 'text/turtle; q=1.0, application/x-turtle; q=0.9, text/n3; q=0.8, application/rdf+xml; q=0.5, text/plain; q=0.1',
    };
  }

  var req = http.request(opt, function(res) {
    var decoder = new StringDecoder('utf8')
      , total = 0
      , body = ''
      , done = false;

    var end = function() {
      if (done) return;
      done = true;
      res.body = body;
      func(null, res);
    };

    res.on('data', function(data) {
      total += data.length;
      body += decoder.write(data);
      if (total > 5120) {
        res.destroy();
        end();
      }
    }).on('error', function(err) {
      res.destroy();
      func(err);
    });

    res.on('end', end);

    // an agent socket's `end` sometimes
    // wont be emitted on the response
    res.socket.on('end', end);
  });
  
  req.on('error', function(error) {
    req.destroy();
    func(error);   
  	
  });



  req.end(body);
};

/**
 * Middleware
 */

// usage:
//   var ping = Pingback.middleware(function() {
//     console.log('Successful pingback from: ' + this.source.href);
//     console.log('Excerpt: ' + this.excerpt);
//   });
//   app.use('/pingback', ping);

Pingback.middleware = function(opt) {
  if (typeof opt === 'function') {
    opt = { end: opt };
  }
  return function(req, res, next) {
    var ping = new Pingback(req, res);
    ping.on('fault', function(code, msg) {
      console.error(
        'Received bad pingback from '
        + this.source.href + '.'
        + ' Fault Code: ' + code
        + ' - Message: ' + msg
      );
    });
    ping.on('error', next);
    ping.on('end', function(source, target, next) {
      if (opt.end.length === 3) {
        opt.end.call(this, source, target, next);
      } else {
        opt.end.call(this, source, target);
        next(); // call success
      }
    });
    req.pipe(ping);
  };
};

module.exports = Pingback;
