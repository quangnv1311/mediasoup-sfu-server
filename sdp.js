const { getCodecInfoFromRtpParameters } = require('./utils');
const fs = require('fs');
// File to create SDP text
module.exports.createSdpText = async (rtpParameters) => {
  const { audio } = rtpParameters;

  // Audio codec info
  const audioCodecInfo = getCodecInfoFromRtpParameters('audio', audio.rtpParameters);

  const sdpString = `v=0 \nt=0 0\no=- 0 0 IN IP4 127.0.0.1\ns=FFmpeg\nm=audio ${audio.remoteRtpPort} RTP/AVP ${audioCodecInfo.payloadType} \nc=IN IP4 127.0.0.1\na=recvonly\na=rtpmap:${audioCodecInfo.payloadType} ${audioCodecInfo.codecName}/${audioCodecInfo.clockRate}/${audioCodecInfo.channels}`;
  console.log(sdpString);
  await fs.writeFile('./stream.sdp', sdpString, 'utf8', err => {
    if(err) {
      console.log('========> Error while write sdp:', err);
    } else {
      console.log('========> Write sdp ok');
    }
  });
};
