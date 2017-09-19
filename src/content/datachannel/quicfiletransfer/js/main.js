/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

var peerAddress;
var isServer;
var udpTransport;
var quicTransport;
var quicStream;
var file;
var myAddressDiv = document.querySelector('div#myAddress');
var peerAddressInput = document.querySelector('input#peerAddress');
var isServerCheckbox = document.querySelector('input#isServer');
var connectButton = document.querySelector('button#connect');
var connectStatusDiv = document.querySelector('div#connectStatus');
var sendProgressPanel = document.querySelector('div#sendProgressPanel');
var receiveProgressPanel = document.querySelector('div#receiveProgressPanel');
var bitrateDiv = document.querySelector('div#bitrate');
var fileInput = document.querySelector('input#fileInput');
var downloadAnchor = document.querySelector('a#download');
var sendProgress = document.querySelector('progress#sendProgress');
var receiveProgress = document.querySelector('progress#receiveProgress');
var statusMessage = document.querySelector('span#status');

var receiveBuffer = [];
var receivedSize = 0;

var bytesPrev = 0;
var timestampPrev = 0;
var timestampStart;
var statsInterval = null;
var bitrateMax = 0;

var udpTransport = new UdpTransport();
setTimeout(function() {
  myAddressDiv.textContent = udpTransport.address;

  var otherUdp = new UdpTransport();
  peerAddressInput.value = otherUdp.address;
  otherUdp.setDestination(udpTransport.address);
  var otherQuicTransport = new QuicTransport(true, otherUdp);
  otherQuicTransport.connect();
  otherQuicTransport.onstream = readFile;
}, 100);

connectButton.addEventListener('click', handleConnectClick, false);

function handleConnectClick() {
  peerAddress = peerAddressInput.value;
  peerAddressInput.disabled = true;
  isServer = isServerCheckbox.checked;
  isServerCheckbox.disabled = true;
  connectButton.disabled = true;
  udpTransport.setDestination(peerAddress);
  console.log(isServer);
  quicTransport = new QuicTransport(isServer, udpTransport);
  try {
    quicTransport.connect();
  } catch (e) {
  }
  connectStatusDiv.textContent = "Connecting...";
  if (isServer) {
    quicTransport.onstream = function(stream) {
      quicStream = stream;
      handleConnected();
    };
  } else {
    tryCreateStream();
  }
}

function tryCreateStream() {
  try {
    var stream = quicTransport.createStream();
  } catch (e) {
    setTimeout(tryCreateStream, 100);
    return;
  }
  quicStream = stream;
  handleConnected();
}

function handleConnected() {
  console.log('connected!');
  connectStatusDiv.textContent = "Connected!";
  if (isServer) {
    receiveProgressPanel.style.display = 'block';
    readFile();
  } else {
    fileInput.style.display = 'block';
    sendProgressPanel.style.display = 'block';
  }
}

fileInput.addEventListener('change', handleFileInputChange, false);

function handleFileInputChange() {
  file = fileInput.files[0];
  if (!file) {
    trace('No file chosen');
  } else {
    fileInput.disabled = true;
    sendFile();
  }
}

function sendOverStream(data, success) {
  try {
    quicStream.write(data);
  } catch (e) {
    // Try again.
    window.setTimeout(sendOverStream, 1, data, success);
    return;
  }
  success();
}

function sendFile() {
  trace('File is ' + [file.name, file.size, file.type,
      file.lastModifiedDate
  ].join(' '));
  sendProgress.max = file.size;
  var header = [
    (file.size >> 24) & 0xff,
    (file.size >> 16) & 0xff,
    (file.size >> 8) & 0xff,
    (file.size) & 0xff,
    (file.name.length >> 8) & 0xff,
    (file.name.length) & 0xff];
  for (var i = 0; i < file.name.length; i++) {
    header.push(file.name.charCodeAt(i));
  }
  sendOverStream(new Uint8Array(header), function() {
    var chunkSize = 16384;
    var fileReader = new window.FileReader();
    var sliceFile = function(offset) {
      var reader = new window.FileReader();
      reader.onload = (function() {
        return function(e) {
          sendOverStream(new Uint8Array(e.target.result), function() {
            if (file.size > offset + e.target.result.byteLength) {
              window.setTimeout(sliceFile, 0, offset + chunkSize);
            }
            sendProgress.value = offset + e.target.result.byteLength;
          });
        };
      })(file);
      var slice = file.slice(offset, offset + chunkSize);
      reader.readAsArrayBuffer(slice);
    };
    sliceFile(0);
  });
}

var readChunks = [];
var readLength = 0;
function readFile(stream) {
  var chunk = stream.read();
  //var chunk = quicStream.read();
  if (chunk.length == 0) {
    setTimeout(readFile, 1, stream);
    return;
  }
  readChunks.push(chunk);
  readLength += chunk.length;
  scanForMetadata();
  if (readFileMetadata && readLength >= readFileMetadata.metaLength + readFileMetadata.fileSize) {
    handleFileRead();
  } else {
    setTimeout(readFile, 0, stream);
  }
}

var readFileMetadata = null;
function scanForMetadata() {
  if (readFileMetadata) {
    return;
  }
  var reader = new MetadataReader();
  for (var i = 0; i < readChunks.length; i++) {
    var chunk = readChunks[i];
    for (var j = 0; j < chunk.length; j++) {
      reader.read(chunk[j]);
      if (reader.done) {
        readFileMetadata = {
          fileSize: reader.filesize,
          fileName: reader.filename,
          metaLength: 6 + reader.filename.length,
        };
        console.log('file metadata');
        console.log(readFileMetadata);
        return;
      }
    }
  }
}

class MetadataReader {
  constructor() {
    this.index = 0;
    this.filesize = 0;
    this.filenamelength = 0;
    this.filename = "";
    this.done = false;
  }

  read(b) {
    if (this.index < 4) {
      this.filesize = this.filesize << 8 | b;
    } else if (this.index < 6) {
      this.filenamelength = this.filenamelength << 8 | b;
    } else if (this.index < 6 + this.filenamelength) {
      this.filename += String.fromCharCode(b);
      if (this.index == 6 + this.filenamelength - 1) {
        this.done = true;
      }
    }
    this.index++;
  }
}

function handleFileRead() {
  console.log('file read done!');
}
  

function createConnection() {
  var servers = null;
  pcConstraint = null;

  // Add localConnection to global scope to make it visible
  // from the browser console.
  window.localConnection = localConnection = new RTCPeerConnection(servers,
      pcConstraint);
  trace('Created local peer connection object localConnection');

  sendChannel = localConnection.createDataChannel('sendDataChannel');
  sendChannel.binaryType = 'arraybuffer';
  trace('Created send data channel');

  sendChannel.onopen = onSendChannelStateChange;
  sendChannel.onclose = onSendChannelStateChange;
  localConnection.onicecandidate = function(e) {
    onIceCandidate(localConnection, e);
  };

  localConnection.createOffer().then(
    gotDescription1,
    onCreateSessionDescriptionError
  );
  // Add remoteConnection to global scope to make it visible
  // from the browser console.
  window.remoteConnection = remoteConnection = new RTCPeerConnection(servers,
      pcConstraint);
  trace('Created remote peer connection object remoteConnection');

  remoteConnection.onicecandidate = function(e) {
    onIceCandidate(remoteConnection, e);
  };
  remoteConnection.ondatachannel = receiveChannelCallback;

  fileInput.disabled = true;
}

function onCreateSessionDescriptionError(error) {
  trace('Failed to create session description: ' + error.toString());
}

function sendData() {
  var file = fileInput.files[0];
  trace('File is ' + [file.name, file.size, file.type,
      file.lastModifiedDate
  ].join(' '));

  // Handle 0 size files.
  statusMessage.textContent = '';
  downloadAnchor.textContent = '';
  if (file.size === 0) {
    bitrateDiv.innerHTML = '';
    statusMessage.textContent = 'File is empty, please select a non-empty file';
    closeDataChannels();
    return;
  }
  sendProgress.max = file.size;
  receiveProgress.max = file.size;
  var chunkSize = 16384;
  var sliceFile = function(offset) {
    var reader = new window.FileReader();
    reader.onload = (function() {
      return function(e) {
        sendChannel.send(e.target.result);
        if (file.size > offset + e.target.result.byteLength) {
          window.setTimeout(sliceFile, 0, offset + chunkSize);
        }
        sendProgress.value = offset + e.target.result.byteLength;
      };
    })(file);
    var slice = file.slice(offset, offset + chunkSize);
    reader.readAsArrayBuffer(slice);
  };
  sliceFile(0);
}

function closeDataChannels() {
  trace('Closing data channels');
  sendChannel.close();
  trace('Closed data channel with label: ' + sendChannel.label);
  if (receiveChannel) {
    receiveChannel.close();
    trace('Closed data channel with label: ' + receiveChannel.label);
  }
  localConnection.close();
  remoteConnection.close();
  localConnection = null;
  remoteConnection = null;
  trace('Closed peer connections');

  // re-enable the file select
  fileInput.disabled = false;
}

function gotDescription1(desc) {
  localConnection.setLocalDescription(desc);
  trace('Offer from localConnection \n' + desc.sdp);
  remoteConnection.setRemoteDescription(desc);
  remoteConnection.createAnswer().then(
    gotDescription2,
    onCreateSessionDescriptionError
  );
}

function gotDescription2(desc) {
  remoteConnection.setLocalDescription(desc);
  trace('Answer from remoteConnection \n' + desc.sdp);
  localConnection.setRemoteDescription(desc);
}

function getOtherPc(pc) {
  return (pc === localConnection) ? remoteConnection : localConnection;
}

function getName(pc) {
  return (pc === localConnection) ? 'localPeerConnection' :
      'remotePeerConnection';
}

function onIceCandidate(pc, event) {
  getOtherPc(pc).addIceCandidate(event.candidate)
  .then(
    function() {
      onAddIceCandidateSuccess(pc);
    },
    function(err) {
      onAddIceCandidateError(pc, err);
    }
  );
  trace(getName(pc) + ' ICE candidate: \n' + (event.candidate ?
      event.candidate.candidate : '(null)'));
}

function onAddIceCandidateSuccess() {
  trace('AddIceCandidate success.');
}

function onAddIceCandidateError(error) {
  trace('Failed to add Ice Candidate: ' + error.toString());
}

function receiveChannelCallback(event) {
  trace('Receive Channel Callback');
  receiveChannel = event.channel;
  receiveChannel.binaryType = 'arraybuffer';
  receiveChannel.onmessage = onReceiveMessageCallback;
  receiveChannel.onopen = onReceiveChannelStateChange;
  receiveChannel.onclose = onReceiveChannelStateChange;

  receivedSize = 0;
  bitrateMax = 0;
  downloadAnchor.textContent = '';
  downloadAnchor.removeAttribute('download');
  if (downloadAnchor.href) {
    URL.revokeObjectURL(downloadAnchor.href);
    downloadAnchor.removeAttribute('href');
  }
}

function onReceiveMessageCallback(event) {
  // trace('Received Message ' + event.data.byteLength);
  receiveBuffer.push(event.data);
  receivedSize += event.data.byteLength;

  receiveProgress.value = receivedSize;

  // we are assuming that our signaling protocol told
  // about the expected file size (and name, hash, etc).
  var file = fileInput.files[0];
  if (receivedSize === file.size) {
    var received = new window.Blob(receiveBuffer);
    receiveBuffer = [];

    downloadAnchor.href = URL.createObjectURL(received);
    downloadAnchor.download = file.name;
    downloadAnchor.textContent =
      'Click to download \'' + file.name + '\' (' + file.size + ' bytes)';
    downloadAnchor.style.display = 'block';

    var bitrate = Math.round(receivedSize * 8 /
        ((new Date()).getTime() - timestampStart));
    bitrateDiv.innerHTML = '<strong>Average Bitrate:</strong> ' +
        bitrate + ' kbits/sec (max: ' + bitrateMax + ' kbits/sec)';

    if (statsInterval) {
      window.clearInterval(statsInterval);
      statsInterval = null;
    }

    closeDataChannels();
  }
}

function onSendChannelStateChange() {
  var readyState = sendChannel.readyState;
  trace('Send channel state is: ' + readyState);
  if (readyState === 'open') {
    sendData();
  }
}

function onReceiveChannelStateChange() {
  var readyState = receiveChannel.readyState;
  trace('Receive channel state is: ' + readyState);
  if (readyState === 'open') {
    timestampStart = (new Date()).getTime();
    timestampPrev = timestampStart;
    statsInterval = window.setInterval(displayStats, 500);
    window.setTimeout(displayStats, 100);
    window.setTimeout(displayStats, 300);
  }
}

// display bitrate statistics.
function displayStats() {
  var display = function(bitrate) {
    bitrateDiv.innerHTML = '<strong>Current Bitrate:</strong> ' +
        bitrate + ' kbits/sec';
  };

  if (remoteConnection && remoteConnection.iceConnectionState === 'connected') {
    if (adapter.browserDetails.browser === 'chrome') {
      // TODO: once https://code.google.com/p/webrtc/issues/detail?id=4321
      // lands those stats should be preferrred over the connection stats.
      remoteConnection.getStats(null, function(stats) {
        for (var key in stats) {
          var res = stats[key];
          if (timestampPrev === res.timestamp) {
            return;
          }
          if (res.type === 'googCandidatePair' &&
              res.googActiveConnection === 'true') {
            // calculate current bitrate
            var bytesNow = res.bytesReceived;
            var bitrate = Math.round((bytesNow - bytesPrev) * 8 /
                (res.timestamp - timestampPrev));
            display(bitrate);
            timestampPrev = res.timestamp;
            bytesPrev = bytesNow;
            if (bitrate > bitrateMax) {
              bitrateMax = bitrate;
            }
          }
        }
      });
    } else {
      // Firefox currently does not have data channel stats. See
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1136832
      // Instead, the bitrate is calculated based on the number of
      // bytes received.
      var bytesNow = receivedSize;
      var now = (new Date()).getTime();
      var bitrate = Math.round((bytesNow - bytesPrev) * 8 /
          (now - timestampPrev));
      display(bitrate);
      timestampPrev = now;
      bytesPrev = bytesNow;
      if (bitrate > bitrateMax) {
        bitrateMax = bitrate;
      }
    }
  }
}
