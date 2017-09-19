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
var myIceCandidatesTextarea = document.querySelector('textarea#myIceCandidates');
var peerIceCandidatesTextarea = document.querySelector('textarea#peerIceCandidates');
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

var iceTransport = new IceTransport();
var iceCandidates = [];
iceTransport.onicecandidate = function(e) {
  iceCandidates.push(e.candidate.candidate);
  myIceCandidatesTextarea.value = iceCandidates.join('\n');
};

var otherIceCandidates = [];
var otherIce = new IceTransport();
otherIce.onicecandidate = function(e) {
  otherIceCandidates.push(e.candidate.candidate);
  peerIceCandidatesTextarea.value = otherIceCandidates.join('\n');
}

function loadIceCandidates(str, ice) {
  var parts = str.split('\n');
  var candidates = [];
  for (var i = 0; i < candidates.length; i++) {
    if (parts[i]) {
      ice.addRemoteCandidate(parts[i]);
    }
  }
}

setTimeout(function() {
  for (var i = 0; i < iceCandidates.length; i++) {
    otherIce.addRemoteCandidate(iceCandidates[i]);
  }
  var otherQuicTransport = new QuicTransport(true, otherIce);
  otherQuicTransport.onstream = readFile;
}, 100);

connectButton.addEventListener('click', handleConnectClick, false);

function handleConnectClick() {
  loadIceCandidates(peerIceCandidatesTextarea.value, iceTransport);
  peerIceCandidatesTextarea.disabled = true;
  isServer = isServerCheckbox.checked;
  isServerCheckbox.disabled = true;
  connectButton.disabled = true;
  console.log(isServer);
  quicTransport = new QuicTransport(isServer, iceTransport);
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
    receiveProgressPanel.style.display = 'block';
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
            console.log(offset + e.target.result.byteLength);
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
function readFile(event) {
  var chunk = event.stream.read();
  //var chunk = quicStream.read();
  if (chunk.length == 0) {
    setTimeout(readFile, 1, event);
    return;
  }
  readChunks.push(chunk);
  readLength += chunk.length;
  scanForMetadata();
  if (readFileMetadata) {
    receiveProgress.value = readLength;
  }
  if (readFileMetadata && readLength >= readFileMetadata.fileSize) {
    handleFileRead();
  } else {
    setTimeout(readFile, 0, event);
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
        readLength -= readFileMetadata.metaLength;
        receiveProgress.max = reader.filesize;
        console.log('file metadata');
        console.log(readFileMetadata);
        readChunks[i] = new Uint8Array(chunk, j + 1);
        for (; i >= 0; i--) {
          readChunks.shift();
        }
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
  var blob = new Blob(readChunks);
  downloadAnchor.href = URL.createObjectURL(blob);
  downloadAnchor.download = readFileMetadata.fileName;
  downloadAnchor.textContent = 'Click to download \'' + readFileMetadata.fileName + '\' (' + readFileMetadata.fileSize + ' bytes)';
  downloadAnchor.style.display = 'block';
  console.log('file read done!');
}
