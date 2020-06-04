import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { Socket } from 'ngx-socket-io';
import * as mediasoupClient from "mediasoup-client";

let this$;
@Component({
  selector: 'app-subcribe',
  templateUrl: './subcribe.component.html',
  styleUrls: ['./subcribe.component.scss']
})
export class SubcribeComponent implements OnInit, AfterViewInit, OnDestroy {
  clientId = null;
  device = null;
  consumerTransport = null;
  videoConsumer = null;
  audioConsumer = null;
  remoteContainer: any;
  isSubcribed = false;
  constructor(private socket: Socket) { }

  ngAfterViewInit(): void {
    this.remoteContainer = document.getElementById('remote_container');
  }
  ngOnDestroy(): void {
    this.socket.disconnect();
  }

  ngOnInit() {
  }

  connectSocket() {
    this$ = this;
    if (this.socket) {
      this.socket.disconnect();
      this.clientId = null;
    }

    return new Promise((resolve, reject) => {
      this.socket.connect();

      this.socket.on('connect', function (evt) {
        console.log('socket.io connected()');
      });
      this.socket.on('error', function (err) {
        console.error('socket.io ERROR:', err);
        reject(err);
      });
      this.socket.on('disconnect', function (evt) {
        console.log('socket.io disconnect:', evt);
      });
      this.socket.on('message', message => {
        console.log('socket.io message:', message);
        if (message.type === 'welcome') {
          if (this$.socket.ioSocket.id !== message.id) {
            console.warn('WARN: something wrong with clientID', this$.socket.ioSocket, message.id);
          }

          this$.clientId = message.id;
          console.log('connected to server. clientId=' + this$.clientId);
          resolve();
        }
        else {
          console.error('UNKNOWN message from server:', message);
        }
      });
      this.socket.on('newProducer', async function (message) {
        console.log('socket.io newProducer:', message);
        if (this$.consumerTransport) {
          // start consume
          if (message.kind === 'video') {
            this$.videoConsumer = await this$.consumeAndResume(this$.consumerTransport, message.kind);
          } else if (message.kind === 'audio') {
            this$.audioConsumer = await this$.consumeAndResume(this$.consumerTransport, message.kind);
          }
        }
      });

      this.socket.on('producerClosed', function (message) {
        console.log('socket.io producerClosed:', message);
        const localId = message.localId;
        const remoteId = message.remoteId;
        const kind = message.kind;
        console.log('--try removeConsumer remoteId=' + remoteId + ', localId=' + localId + ', kind=' + kind);
        if (kind === 'video') {
          if (this$.videoConsumer) {
            this$.videoConsumer.close();
            this$.videoConsumer = null;
          }
        } else if (kind === 'audio') {
          if (this$.audioConsumer) {
            this$.audioConsumer.close();
            this$.audioConsumer = null;
          }
        }

        if (remoteId) {
          this$.removeRemoteVideo(remoteId);
        } else {
          this$.removeAllRemoteVideo();
        }
      })
    });
  }

  disconnectSocket() {
    if (this.socket) {
      this.socket.disconnect();
      this.clientId = null;
      console.log('socket.io closed..');
      this.isSubcribed = false;
    }
  }

  isSocketConnected() {
    console.log(this.socket);
    if (this.socket.ioSocket.connected) {
      return true;
    }
    else {
      return false;
    }
  }

  sendRequest(type, data) {
    return new Promise((resolve, reject) => {
      this.socket.emit(type, data, (err, response) => {
        if (!err) {
          // Success response, so pass the mediasoup response to the local Room.
          resolve(response);
        } else {
          reject(err);
        }
      });
    });
  }

  playVideo(element, stream) {
    if (element.srcObject) {
      console.warn('element ALREADY playing, so ignore');
      return;
    }
    element.srcObject = stream;
    element.volume = 0;
    return element.play();
  }

  pauseVideo(element) {
    element.pause();
    element.srcObject = null;
  }

  addRemoteTrack(id, track) {
    let video = this.findRemoteVideo(id) as any;
    if (!video) {
      video = this.addRemoteVideo(id);
    }

    if (video.srcObject) {
      video.srcObject.addTrack(track);
      return;
    }

    const newStream = new MediaStream();
    newStream.addTrack(track);
    this.playVideo(video, newStream)
      .then(() => {
        video.volume = 1.0
      })
      .catch(err => {
        console.error('media ERROR:', err)
      });
  }

  addRemoteVideo(id) {
    let existElement = this.findRemoteVideo(id);
    if (existElement) {
      console.warn('remoteVideo element ALREADY exist for id=' + id);
      return existElement;
    }

    let element = document.createElement('video');
    this.remoteContainer.appendChild(element);
    element.id = 'remote_' + id;
    element.width = 640;
    element.volume = 0;
    return element;
  }

  findRemoteVideo(id) {
    let element = document.getElementById('remote_' + id);
    return element;
  }

  removeRemoteVideo(id) {
    console.log(' ---- removeRemoteVideo() id=' + id);
    let element = document.getElementById('remote_' + id) as any;
    if (element) {
      element.pause();
      element.srcObject = null;
      this.remoteContainer.removeChild(element);
    } else {
      console.log('child element NOT FOUND');
    }
  }

  removeAllRemoteVideo() {
    while (this.remoteContainer.firstChild) {
      this.remoteContainer.firstChild.pause();
      this.remoteContainer.firstChild.srcObject = null;
      this.remoteContainer.removeChild(this.remoteContainer.firstChild);
    }
  }

  async subscribe() {
    if (!this.isSocketConnected()) {
      await this.connectSocket().catch(err => {
        console.error(err);
        return;
      });

      // --- get capabilities --
      const data = await this.sendRequest('getRouterRtpCapabilities', {});
      console.log('getRouterRtpCapabilities:', data);
      await this.loadDevice(data);
    }

    // --- prepare transport ---
    console.log('--- createConsumerTransport --');
    const params = await this.sendRequest('createConsumerTransport', {});
    console.log('transport params:', params);
    this.consumerTransport = this.device.createRecvTransport(params);
    console.log('createConsumerTransport:', this.consumerTransport);

    // --- join & start publish --
    this.consumerTransport.on('connect', async ({
      dtlsParameters
    }, callback, errback) => {
      console.log('--consumer trasnport connect');
      this.sendRequest('connectConsumerTransport', {
        dtlsParameters: dtlsParameters
      })
        .then(callback)
        .catch(errback);

      //consumer = await consumeAndResume(consumerTransport);
    });

    this.consumerTransport.on('connectionstatechange', (state) => {
      switch (state) {
        case 'connecting':
          console.log('subscribing...');
          break;

        case 'connected':
          console.log('subscribed');
          this.isSubcribed = true;
          break;

        case 'failed':
          console.log('failed');
          break;

        default:
          break;
      }
    });

    this.videoConsumer = await this.consumeAndResume(this.consumerTransport, 'video');
    this.audioConsumer = await this.consumeAndResume(this.consumerTransport, 'audio');
  }

  async consumeAndResume(transport, kind) {
    const consumer = await this.consume(this.consumerTransport, kind);
    if (consumer) {
      console.log('-- track exist, consumer ready. kind=' + kind);
      if (kind === 'video') {
        console.log('-- resume kind=' + kind);
        this.sendRequest('resume', {
          kind: kind
        })
          .then(() => {
            console.log('resume OK');
            return consumer;
          })
          .catch(err => {
            console.error('resume ERROR:', err);
            return consumer;
          });
      } else {
        console.log('-- do not resume kind=' + kind);
      }
    } else {
      console.log('-- no consumer yet. kind=' + kind);
      return null;
    }
  }

  disconnect() {
    if (this.videoConsumer) {
      this.videoConsumer.close();
      this.videoConsumer = null;
    }
    if (this.audioConsumer) {
      this.audioConsumer.close();
      this.audioConsumer = null;
    }
    if (this.consumerTransport) {
      this.consumerTransport.close();
      this.consumerTransport = null;
    }

    this.removeAllRemoteVideo();

    this.disconnectSocket();
  }

  async loadDevice(routerRtpCapabilities) {
    try {
      this.device = new mediasoupClient.Device();
    } catch (error) {
      if (error.name === 'UnsupportedError') {
        console.error('browser not supported');
      }
    }
    await this.device.load({
      routerRtpCapabilities
    });
  }

  async consume(transport, trackKind) {
    console.log('--start of consume --kind=' + trackKind);
    const { rtpCapabilities } = this.device;
    //const data = await socket.request('consume', { rtpCapabilities });
    const data = await this.sendRequest('consume', {
      rtpCapabilities: rtpCapabilities,
      kind: trackKind
    }).catch(err => {
        console.error('consume ERROR:', err);
      });

    const dataAs = data as any;
    const producerId = dataAs.producerId;
    const id = dataAs.id;
    const kind = dataAs.kind;
    const rtpParameters = dataAs.rtpParameters;

    if (producerId) {
      let codecOptions = {};
      const consumer = await transport.consume({
        id,
        producerId,
        kind,
        rtpParameters,
        codecOptions,
      });

      this.addRemoteTrack(this.clientId, consumer.track);

      console.log('--end of consume');

      return consumer;
    } else {
      console.warn('--- remote producer NOT READY');

      return null;
    }
  }

}
