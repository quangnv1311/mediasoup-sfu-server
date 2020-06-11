import { Component, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { Socket } from 'ngx-socket-io';
import * as mediasoupClient from "mediasoup-client";
import { AudioRecordService } from '../audio-record.service';
declare var MediaRecorder: any;
let this$;

@Component({
  selector: 'app-livestream',
  templateUrl: './livestream.component.html',
  styleUrls: ['./livestream.component.scss']
})
export class LivestreamComponent implements OnInit, AfterViewInit, OnDestroy {
  clientId = null;
  device = null;
  producerTransport = null;
  audioProducer = null;
  localAudio: any;
  localStream: MediaStream;

  isPublished = false;
  isStartedMedia = false;

	mediaRecorder:any;
  chunks = [];
  audioFiles = [];
  
  constructor(private socket: Socket, private recorder: AudioRecordService) {

  }
  ngOnDestroy(): void {
    this.socket.disconnect();
  }

  ngOnInit(): void {
  }

  ngAfterViewInit(): void {
    this.localAudio = document.getElementById('local_audio');
  }

  connectSocket() {
    this$ = this;

    if (this.socket) {
      this.socket.disconnect();
      this.clientId = null;
    }

    return new Promise((resolve, reject) => {
      this.socket.connect();
      this.socket.on('connect', () => {
        console.log('socket.io connected()');
      });
      this.socket.on('error', err => {
        console.error('socket.io ERROR:', err);
        reject(err);
      });
      this.socket.on('disconnect', evt => {
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
      this.socket.on('newProducer', async message => {
        console.warn('IGNORE socket.io newProducer:', message);
      });
    });
  }

  disconnectSocket() {
    if (this.socket) {
      this.socket.disconnect();
      this.clientId = null;
      console.log('socket.io closed..');
      this.isPublished = false;
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

  stopLocalStream(stream) {
    let tracks = stream.getTracks();
    if (!tracks) {
      console.warn('NO tracks');
      return;
    }
    tracks.forEach(track => track.stop());
    this.isStartedMedia = false;
  }

  playAudio(element, stream) {
    if (element.srcObject) {
      console.warn('element ALREADY playing, so ignore');
      return;
    }
    element.srcObject = stream;
    element.volume = 0;
    element.controls = true;
    this.isStartedMedia = true;
    return element.play();
  }

  pauseAudio(element) {
    element.pause();
    element.srcObject = null;
  }

  startMedia() {
    if (this.localStream) {
      console.warn('WARN: local media ALREADY started');
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        this.localStream = stream;
        this.recorder.startRecording(stream);
        this.playAudio(this.localAudio, this.localStream);
      })
      .catch(err => {
        console.error('media ERROR:', err);
      });
  }

  pauseMedia() {
    this.recorder.pauseRecording();
  }

  resumeMedia() {
    this.recorder.resumeRecording();
  }

  download(data) {
    const a =  document.createElement('a');
    a.href = URL.createObjectURL(data.blob);
    a.download = data.title;
    a.click();
  }

  stopMedia() {
    if (this.localStream) {
      this.recorder.stopRecording();
      this.recorder.getRecordedBlob().subscribe(data => {
        this.download(data);
      })
      this.pauseAudio(this.localAudio);
      this.stopLocalStream(this.localStream);
      this.localStream = null;
    }
  }

  async publish() {
    if (!this.localStream) {
      console.warn('WARN: local media NOT READY');
      return;
    }

    // --- connect socket.io ---
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

    // --- get transport info ---
    console.log('--- createProducerTransport --');
    const params = await this.sendRequest('createProducerTransport', {});
    console.log('transport params:', params);
    this.producerTransport = this.device.createSendTransport(params);
    console.log('createSendTransport:', this.producerTransport);

    // --- join & start publish --
    this.producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      console.log('--trasnport connect');
      this.sendRequest('connectProducerTransport', { dtlsParameters: dtlsParameters })
        .then(callback)
        .catch(errback);
    });

    this.producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
      console.log('--trasnport produce');
      try {
        const id = await this.sendRequest('produce', {
          transportId: this.producerTransport.id,
          kind,
          rtpParameters,
        });
        callback({ id: id });
      } catch (err) {
        errback(err);
      }
    });

    this.producerTransport.on('connectionstatechange', (state) => {
      switch (state) {
        case 'connecting':
          console.log('publishing...');
          break;

        case 'connected':
          console.log('published');
          this.isPublished = true;
          break;

        case 'failed':
          console.log('failed');
          this.producerTransport.close();
          break;

        default:
          break;
      }
    });

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      const trackParams = { track: audioTrack };
      this.audioProducer = await this.producerTransport.produce(trackParams);
    }

  }

  async pauseLiveStream() {
    await this.sendRequest('pause', this$.clientId);
  }

  async resumeLiveStream() {
    await this.sendRequest('resume', this$.clientId);
  }

  disconnect() {
    if (this.localStream) {
      this.pauseAudio(this.localAudio);
      this.stopLocalStream(this.localStream);
      this.localStream = null;
    }

    if (this.audioProducer) {
      this.audioProducer.close(); // localStream will stop
      this.audioProducer = null;
    }
    if (this.producerTransport) {
      this.producerTransport.close(); // localStream will stop
      this.producerTransport = null;
    }

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
    await this.device.load({ routerRtpCapabilities });
  }

}
