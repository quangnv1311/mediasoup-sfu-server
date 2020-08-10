require("dotenv").config();
const FormData = require('form-data');
const https = require('https');
const child_process = require('child_process');
const { createSdpText } = require('./sdp');

const RECORD_FILE_LOCATION_PATH = process.env.RECORD_FILE_LOCATION_PATH || './record-files';

module.exports = class FFmpeg {
  constructor(rtpParameters, fileName) {
    this._rtpParameters = rtpParameters;
    this.fileName = fileName + '.mp3';
    this._process = undefined;
    this.logId = null;
    this.tokenUpload = null; //Token upload to ds server
    this._createProcess();
  }

  _createProcess() {
    createSdpText(this._rtpParameters);
    this.processFFMPEG();
  }

  stopRecord() {
    const fs = require('fs');
    const filePath = `${RECORD_FILE_LOCATION_PATH}/${this.fileName}`;
    if(fs.existsSync(`${RECORD_FILE_LOCATION_PATH}/${this.fileName}`)) {
      const audioRecordFile = fs.createReadStream(filePath);
      let formData = new FormData();
      formData.append('file', audioRecordFile);
      const axios = require('axios').default;
    
      axios.post(`${process.env.DS_SERVER}/api/private/report/livestream/write?id=${this.logId}&token=${this.tokenUpload}`, formData, {
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        }),
        headers: formData.getHeaders()
      }).then(res => {
        console.log('=============> Res', res);
        fs.unlink(filePath, err =>{
          console.log('==========> Delete record file');
        });
      }).catch(err => {
        console.log('=============> Error ', err);
        fs.unlink(filePath, err =>{
          console.log('==========> Delete record file');
        });
      });
    }
  }

  setDataLog(logId, token) {
    this.logId = logId;
    this.tokenUpload = token;
  }

  processFFMPEG() {
    this._process = child_process.exec('powershell.exe ' + this._commandArgs());

    if (this._process.stderr) {
      this._process.stderr.setEncoding('utf-8');

      this._process.stderr.on('data', data =>
        console.log('ffmpeg::process::data [data:%o]', data)
      );
    }

    if (this._process.stdout) {
      this._process.stdout.setEncoding('utf-8');

      this._process.stdout.on('data', data =>
        console.log('ffmpeg::process::data [data:%o]', data)
      );
    }

    this._process.on('message', message =>
      console.log('ffmpeg::process::message [message:%o]', message)
    );

    this._process.on('error', error =>
      console.error('ffmpeg::process::error [error:%o]', error)
    );

    this._process.once('close', () => {
      this.stopRecord();
      console.log('ffmpeg::process::close');
    });
  }

  kill() {
    console.log('kill() [pid:%d]', this._process.pid);
    this._process.kill("SIGINT");
    this._process.stdin.write("q"); // Kill ffmpeg process
  }

  _commandArgs() {
    let commandArgs = [
      'ffmpeg',
      '-protocol_whitelist',
      'file,rtp,udp',
      '-re',
      '-acodec',
      'opus',
      '-i',
      './stream.sdp',
      '-acodec',
      'mp3'
    ];

    commandArgs = commandArgs.concat([
      `${RECORD_FILE_LOCATION_PATH}/${this.fileName}`
    ]);

    console.log('commandArgs:%o', commandArgs);

    return commandArgs.join(' ');
  }
}
