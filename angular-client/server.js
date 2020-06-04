const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
require("dotenv").config();

let serverOptions = {
  listenPort: process.env.PORT || 4200,
  httpsKeyFile: process.env.SSL_KEY_FILE || 'keys/server.key',
  httpsCertFile: process.env.SSL_CERT_FILE || 'keys/server.crt'
};

let sslOptions = {
  key: '',
  cert: ''
};

const isHerokuEnv = process.env.IS_HEROKU_ENV;

sslOptions.key = fs.readFileSync(serverOptions.httpsKeyFile).toString();
sslOptions.cert = fs.readFileSync(serverOptions.httpsCertFile).toString();

const app = express();

app.use(express.static(__dirname + '/dist/angular-client'));

app.get('/*', (req, res) => res.sendFile(path.join(__dirname)));

let server;
if (isHerokuEnv == 1) {
  server = http.createServer(app);
} else {
  server = https.createServer(sslOptions, app);
}

server.listen(serverOptions.listenPort, () => console.log(`App running on https://127.0.0.1:${serverOptions.listenPort}`));
