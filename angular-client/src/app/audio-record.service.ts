import { Injectable } from '@angular/core';
import * as RecordRTC from 'recordrtc';
import { Subject, Observable } from 'rxjs';
import * as moment from 'moment';

interface RecordedAudioOutput {
  blob: Blob;
  title: string;
}

@Injectable({
  providedIn: 'root'
})
export class AudioRecordService {
  private stream;
  private recorder;
  private interval;
  private startTime;
  private _recorded = new Subject<any>();
  private _recordingTime = new Subject<string>();
  private _recordingFailed = new Subject<string>();
  constructor() { }

  getRecordedBlob(): Observable<RecordedAudioOutput> {
    return this._recorded.asObservable();
  }

  getRecordedTime(): Observable<string> {
    return this._recordingTime.asObservable();
  }

  recordingFailed(): Observable<string> {
    return this._recordingFailed.asObservable();
  }

  startRecording(stream) {
    if (this.recorder) {
      return;
    }
    this._recordingTime.next('00:00');
    this.stream = stream;
    this.record();
  }

  private record() {
    this.recorder = new RecordRTC.StereoAudioRecorder(this.stream, {
      type: 'audio',
      mimeType: 'audio/webm',
      numberOfAudioChannels: 1
    });

    this.recorder.record();
    this.startTime = moment();
    this.interval = setInterval(
      () => {
        const currentTime = moment();
        const diffTime = moment.duration(currentTime.diff(this.startTime));
        const time = this.toString(diffTime.minutes()) + ':' + this.toString(diffTime.seconds());
        this._recordingTime.next(time);
      }, 1000
    );
  }

  pauseRecording() {
    this.recorder.pause();
  }

  resumeRecording() {
    this.recorder.resume();
  }

  stopRecording() {
    if (this.recorder) {
      this.recorder.stop((blob) => {
        if (this.startTime) {
          const mp3Name = encodeURIComponent('audio_' + new Date().getTime() + '.mp3');
          this.stop();
          this._recorded.next({ blob: blob, title: mp3Name });
        }
      }, () => {
        this.stop();
        this._recordingFailed.next();
      });
    }
  }

  private stop() {
    if (this.recorder) {
      this.recorder = null;
      clearInterval(this.interval);
      this.startTime = null;
    }
  }

  abortRecording() {
    this.stop();
  }

  private toString(value) {
    let val = value;
    if (!value) {
      val = '00';
    }
    if (value < 10) {
      val = '0' + value;
    }
    return val;
  }
}
