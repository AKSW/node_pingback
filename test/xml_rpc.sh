curl "localhost:5000/ping" --header "Content-Type: text/xml" --data "<?xmlversion="1.0"?><methodCall><methodName>pingback.ping</methodName><params><param><value><string>http://localhost:4000/#me</string></value></param><param><value><string>http://localhost:5000</string></value></param></params></methodCall>"

