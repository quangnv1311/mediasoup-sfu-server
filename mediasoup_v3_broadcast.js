require("dotenv").config();
const fs = require('fs');
const FFmpeg = require('./ffmpeg');
const {
  getPort,
  releasePort
} = require('./port');

const config = {
  ipMediaSoup: process.env.IP_MEDIA_SOUP || '127.0.0.1',
  ipPublicMediaSoup: process.env.PUBLIC_IP_MEDIA_SOUP || '127.0.0.1',
  dsServer: process.env.DS_SERVER || 'https://127.0.0.1:8488'
};

let serverOptions = {
  hostName: process.env.HOST || '127.0.0.1',
  listenPort: process.env.PORT || 3000,
  httpsKeyFile: process.env.SSL_KEY_FILE || 'keys/server.key',
  httpsCertFile: process.env.SSL_CERT_FILE || 'keys/server.crt',
  rtcMinPort: process.env.RTC_MIN_PORT || 10000,
  rtcMaxPort: process.env.RTC_MAX_PORT || 59999
};

let sslOptions = {
  key: '',
  cert: ''
};

if (isFileExist(serverOptions.httpsKeyFile) && isFileExist(serverOptions.httpsCertFile)) {
  sslOptions.key = fs.readFileSync(serverOptions.httpsKeyFile).toString();
  sslOptions.cert = fs.readFileSync(serverOptions.httpsCertFile).toString();
} else {
  console.log('==== SSL cert path is not valid ====');
  process.exit();
}

const https = require("https");
const express = require('express');
const axios = require('axios').default;

const app = express();
const webPort = serverOptions.listenPort;

let webServer = null;
let loadBalanceCount = 0;

webServer = https.createServer(sslOptions, app).listen(webPort, function () {
  console.log('Media server start on https://' + serverOptions.hostName + ':' + webServer.address().port + '/');
  console.log(`RTC port range: ${serverOptions.rtcMinPort} - ${serverOptions.rtcMaxPort}`)
});

app.get('', (req, res, next) => {
  res.json({
    msg: 'Mediasoup server is started'
  });
});

function isFileExist(path) {
  try {
    fs.accessSync(path, fs.constants.R_OK);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false
    }
  }
  return false;
}

// --- socket.io server ---
const io = require('socket.io')(webServer);
// console.log('socket.io server start. port=' + webServer.address().port);

io.use((socket, next) => {
  const token = socket.handshake.query.token;

  //SSL fake
  const instance = axios.create({
    httpsAgent: new https.Agent({
      rejectUnauthorized: false
    })
  });
  instance.get(`${config.dsServer}/api/player/validate_token`, {
    params: {
      token: token
    }
  }).then(res => {
    if (res.data.status === 'success') {
      next();
    } else {
      next('Authentication error');
    }
  })
    .catch(err => {
      next('Authentication error: ' + err);
      console.log(err);
    });
});

io.on('connection', function (socket) {
  console.log('client connected. socket id=' + getId(socket) + '  , total clients=' + getClientCount());
  loadBalanceCount = getClientCount();
  var interval = setInterval(() => {
    if (producerReady) {
      io.to(getId(socket)).emit('newProducer', {
        kind: 'audio'
      });
      clearInterval(interval);
      interval = null;
    }
  }, 500);
  socket.on('disconnect', function () {
    if (isRecord) {
      stopRecord();
      console.log('Stopped recording');
    }

    // close user connection
    console.log('client disconnected. socket id=' + getId(socket) + '  , total clients=' + getClientCount());
    loadBalanceCount = getClientCount();
    cleanUpPeer(socket);
  });
  socket.on('error', function (err) {
    console.error('socket ERROR:', err);
  });
  socket.on('connect_error', (err) => {
    console.error('client connection error', err);
  });

  socket.on('getRouterRtpCapabilities', (data, callback) => {
    if (router) {
      // console.log('getRouterRtpCapabilities: ', router.rtpCapabilities);
      sendResponse(router.rtpCapabilities, callback);
    } else {
      sendReject({
        text: 'ERROR- router NOT READY'
      }, callback);
    }
  });

  // --- producer ----
  socket.on('createProducerTransport', async (data, callback) => {
    // console.log('createProducerTransport');
    if (producerTransport !== null) {
      sendResponse({
        existLiveStream: true
      }, callback);
    }
    producerSocketId = getId(socket);
    const {
      transport,
      params
    } = await createTransport();
    producerTransport = transport;
    producerTransport.observer.on('close', () => {
      if (audioProducer) {
        audioProducer.close();
        audioProducer = null;
      }
      producerTransport = null;
    });
    sendResponse(params, callback);
  });

  socket.on('connectProducerTransport', async (data, callback) => {
    await producerTransport.connect({
      dtlsParameters: data.dtlsParameters
    });
    sendResponse({}, callback);
  });

  socket.on('uploadRecord', data => {
    recordLogId = data.logId;
    tokenUpload = data.token;
    recordProcess.setDataLog(recordLogId, tokenUpload);
  });

  socket.on('produce', async (data, callback) => {
    const {
      livestreamName,
      record,
      kind,
      rtpParameters
    } = data;
    // console.log('produce: kind=', kind);
    liveStreamName = livestreamName;
    isRecord = record;
    audioProducer = await producerTransport.produce({
      kind,
      rtpParameters
    });

    //Load balance
    if (loadBalance() !== 1) {
      if (loadBalance() === 2) {
        await router.pipeToRouter({
          producerId: audioProducer.id,
          router: router2
        });
      } else if (loadBalance() === 3) {
        await router.pipeToRouter({
          producerId: audioProducer.id,
          router: router3
        });
      } else {
        await router.pipeToRouter({
          producerId: audioProducer.id,
          router: router4
        });
      }
    }

    audioProducer.observer.on('close', () => {
      console.log('audioProducer closed');
      producerReady = false;
    })

    sendResponse({
      id: audioProducer.id
    }, callback);

    console.log('broadcast newProducer: kind=', kind);
    producerReady = true;
    if (isRecord) {
      console.log('Start record');
      startRecord(router, audioProducer);
    }
    // socket.broadcast.emit('newProducer', {
    //     kind: kind
    // });
  });

  // --- consumer ----
  socket.on('createConsumerTransport', async (data, callback) => {
    console.log('createConsumerTransport');
    const {
      transport,
      params
    } = await createTransport();
    addConsumerTrasport(getId(socket), transport);
    transport.observer.on('close', () => {
      const id = getId(socket);
      console.log('consumerTransport closed');
      const consumer = getAudioConsumer(getId(socket));
      if (consumer) {
        consumer.close();
        removeAudioConsumer(id);
      }
      removeConsumerTransport(id);
    });
    sendResponse(params, callback);
  });

  socket.on('connectConsumerTransport', async (data, callback) => {
    let transport = getConsumerTrasnport(getId(socket));
    console.log('connectConsumerTransport', data, getId(socket));
    if (!transport) {
      console.error('transport not exist for id=' + getId(socket));
      sendResponse({}, callback);
      return;
    }
    await transport.connect({
      dtlsParameters: data.dtlsParameters
    });
    sendResponse({}, callback);
  });

  socket.on('consume', async (data, callback) => {
    const rtpCapabilities = JSON.parse(data.rtpCapabilities);
    const kind = 'audio';
    console.log('consume: kind=' + kind);
    if (audioProducer) {
      let transport = getConsumerTrasnport(getId(socket));
      if (!transport) {
        console.error('transport not exist for id=' + getId(socket));
        return;
      }
      const {
        consumer,
        params
      } = await createConsumer(transport, audioProducer, rtpCapabilities);
      const id = getId(socket);
      addAudioConsumer(id, consumer);
      consumer.observer.on('close', () => {
        console.log('consumer closed');
        console.log('=========================')
      });
      consumer.on('producerclose', () => {
        console.log('consumer: on.producerclose');
        consumer.close();
        removeAudioConsumer(id);

        // -- notify to client ---

        socket.broadcast.emit('producerClosed', {
          localId: id,
          remoteId: producerSocketId,
          kind: 'audio'
        });
      });
      console.log('consumer ready');
      sendResponse(params, callback);
    } else {
      console.log('consume, but audio producer not ready');
      const params = {
        producerId: null,
        id: null,
        kind: 'audio',
        rtpParameters: {}
      };
      sendResponse(params, callback);
    }
  });

  socket.on('pause', async (data, callback) => {
    audioProducer.pause();
    audioProducer.on('producerpause', () => {
      sendResponse({
        paused: true
      }, callback);
    });
  });

  socket.on('resume', async (data, callback) => {
    audioProducer.resume();
    audioProducer.on('producerresume', () => {
      sendResponse({
        resumed: true
      }, callback);
    });
  });

  // --- send response to client ---
  function sendResponse(response, callback) {
    callback(null, response);
  }

  // --- send error to client ---
  function sendReject(error, callback) {
    callback(error.toString(), null);
  }
});

function getId(socket) {
  return socket.id;
}

function getClientCount() {
  return io.eio.clientsCount;
}

function cleanUpPeer(socket) {
  liveStreamName = null;
  const id = getId(socket);

  const transport = getConsumerTrasnport(id);
  if (transport) {
    transport.close();
    removeConsumerTransport(id);
  }

  if (producerSocketId === id) {
    console.log('cleanup producer');
    if (audioProducer) {
      audioProducer.close();
      audioProducer = null;
    }

    if (producerTransport) {
      producerTransport.close();
      producerTransport = null;
    }

    producerSocketId = null;
  }
}

// ========= mediasoup ===========
const mediasoup = require("mediasoup");
const {
  Z_FULL_FLUSH
} = require("zlib");
const mediasoupOptions = {
  // Worker settings
  worker: {
    rtcMinPort: serverOptions.rtcMinPort,
    rtcMaxPort: serverOptions.rtcMaxPort,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp'
    ],
  },
  // Router settings
  router: {
    mediaCodecs: [{
      // kind: 'audio',
      // mimeType: 'audio/PCMA',
      // preferredPayloadType: 8,
      // clockRate: 8000,
      // rtcpFeedback: [{
      //   type: 'transport-cc'
      // }]
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2
    }]
  },
  // WebRtcTransport settings
  webRtcTransport: {
    listenIps: [{
      ip: config.ipMediaSoup,
      announcedIp: config.ipPublicMediaSoup
    }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    preferTcp: true,
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000,
  },
  plainRtpTransport: {
    listenIp: '127.0.0.1',
    rtcpMux: true,
    comedia: false
  }
};

let worker = null;
let worker2 = null; //Use multi cpu
let worker3 = null;
let worker4 = null;
let router = null;
let router2 = null; //Use multi cpu
let router3 = null;
let router4 = null;
let producerTransport = null;
let audioProducer = null;
let producerReady = false;
let producerSocketId = null;
//Record
let recordProcess = undefined;
let rtpPortUse = null;
let liveStreamName = null;
let ffmpegConsumer = null;
let isRecord = false;
let recordLogId = null;
let tokenUpload = null;

async function startWorker() {
  const mediaCodecs = mediasoupOptions.router.mediaCodecs;
  worker = await mediasoup.createWorker(mediasoupOptions.worker);
  worker2 = await mediasoup.createWorker(mediasoupOptions.worker);
  worker3 = await mediasoup.createWorker(mediasoupOptions.worker);
  worker4 = await mediasoup.createWorker(mediasoupOptions.worker);

  router = await worker.createRouter({
    mediaCodecs
  });
  router2 = await worker2.createRouter({
    mediaCodecs
  });
  router3 = await worker3.createRouter({
    mediaCodecs
  });
  router4 = await worker4.createRouter({
    mediaCodecs
  });
  console.log('Mediasoup 4 workers started');
}

startWorker();

let transports = {};
let audioConsumers = {};

function getConsumerTrasnport(id) {
  return transports[id];
}

function addConsumerTrasport(id, transport) {
  transports[id] = transport;
  console.log('consumerTransports count=' + Object.keys(transports).length);
}

function removeConsumerTransport(id) {
  delete transports[id];
  console.log('consumerTransports count=' + Object.keys(transports).length);
}

function getAudioConsumer(id) {
  return audioConsumers[id];
}

function addAudioConsumer(id, consumer) {
  audioConsumers[id] = consumer;
  console.log('audioConsumers count=' + Object.keys(audioConsumers).length);
}

function removeAudioConsumer(id) {
  delete audioConsumers[id];
  console.log('audioConsumers count=' + Object.keys(audioConsumers).length);
}

async function createTransport() {
  let transport = null;
  if (loadBalance() === 1) {
    transport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);
  } else if (loadBalance() === 2) {
    transport = await router2.createWebRtcTransport(mediasoupOptions.webRtcTransport);
  } else if (loadBalance() === 3) {
    transport = await router3.createWebRtcTransport(mediasoupOptions.webRtcTransport);
  } else {
    transport = await router4.createWebRtcTransport(mediasoupOptions.webRtcTransport);
  }

  console.log('create transport id=' + transport.id);

  return {
    transport: transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    }
  };
}

async function createPlainTransport() {
  let plainTransport = null;
  if (loadBalance() === 1) {
    plainTransport = await router.createPlainTransport(mediasoupOptions.plainRtpTransport);
  } else if (loadBalance() === 2) {
    plainTransport = await router2.createPlainTransport(mediasoupOptions.plainRtpTransport);
  } else if (loadBalance() === 3) {
    plainTransport = await router3.createPlainTransport(mediasoupOptions.plainRtpTransport);
  } else {
    plainTransport = await router4.createPlainTransport(mediasoupOptions.plainRtpTransport);
  }

  return plainTransport;
}

async function createConsumer(transport, producer, rtpCapabilities) {
  let consumer = null;
  if (!router.canConsume({
    producerId: producer.id,
    rtpCapabilities,
  })) {
    console.error('can not consume');
    return;
  }

  consumer = await transport.consume({ // OK
    producerId: producer.id,
    rtpCapabilities,
    paused: false,
  }).catch(err => {
    console.error('consume failed', err);
    return;
  });

  return {
    consumer: consumer,
    params: {
      producerId: producer.id,
      id: consumer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused
    }
  };
}

function loadBalance() {
  if (loadBalanceCount < 100) {
    return 1;
  }
  if (loadBalanceCount > 100) {
    return 2;
  }
  if (loadBalanceCount > 200) {
    return 3;
  }
  if (loadBalanceCount > 300) {
    return 4;
  }
}

async function startRecord(router, producer) {
  let recordInfo = {};
  recordInfo[producer.kind] = await publishProducerRtpStream(router, producer);
  const fileName = `${liveStreamName}-${new Date().getTime()}`;
  recordProcess = new FFmpeg(recordInfo, fileName);
}

function stopRecord() {
  recordProcess.kill();
  recordProcess = undefined;
  if (rtpPortUse) {
    releasePort(rtpPortUse);
    rtpPortUse = null;
  }

  if (ffmpegConsumer) {
    ffmpegConsumer.close();
    ffmpegConsumer = null;
  }
}

async function publishProducerRtpStream(router, producer, ffmpegRtpCapabilities) {
  console.log('publishProducerRtpStream()');

  // Create the mediasoup RTP Transport used to send media to the GStreamer process
  const rtpTransportConfig = mediasoupOptions.plainRtpTransport;

  console.log('createPlainTransport', rtpTransportConfig);
  const rtpTransport = await createPlainTransport(rtpTransportConfig);

  // Set the receiver RTP ports
  const remoteRtpPort = await getPort();

  // Connect to plainTransport
  await rtpTransport.connect({
    ip: '127.0.0.1',
    port: remoteRtpPort
  });

  const codecs = [];
  // Codec passed to the RTP Consumer must match the codec in the Mediasoup router rtpCapabilities
  const routerCodec = router.rtpCapabilities.codecs.find(
    codec => codec.kind === producer.kind
  );
  codecs.push(routerCodec);

  const rtpCapabilities = {
    codecs,
    rtcpFeedback: []
  };

  ffmpegConsumer = await rtpTransport.consume({
    producerId: producer.id,
    rtpCapabilities,
    paused: false
  });

  return {
    remoteRtpPort,
    rtpCapabilities,
    rtpParameters: ffmpegConsumer.rtpParameters
  };
}