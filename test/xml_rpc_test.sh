curl "localhost:5000/ping" --header "Content-Type: text/xml" --data "<?xmlversion="1.0"?><methodCall><methodName>pingback.ping</methodName><params><param><value><string>http://aksw.org/SebastianTramp</string></value></param><param><value><string>http://aksw.org/Projects/DSSN</string></value></param></params></methodCall>"

