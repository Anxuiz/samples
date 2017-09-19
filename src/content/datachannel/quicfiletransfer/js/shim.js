class VirtualNetwork {
  constructor() {
    this.transportsFrom = {};
    this.transportsTo = {};
    this.nextPortSeg = 1;
  }

  /* QuicTransport */ getTransportAt(/* DOMString */ address) {
    return this.transportsFrom[address];
  }

  /* QuicTransport */ getTransportTo(/* DOMString */ address) {
    return this.transportsTo[address];
  }

  /* DOMString */ allocatePort() {
    var i = this.nextPortSeg++;
    return "" + i + i + i + i;
  }
}
var VN = new VirtualNetwork();

class UdpTransport {
  constructor() {
    this.destination = null;
  }

  /* DOMString */ getAddress() {
    return "192.168.1.5:" + VN.allocatePort();
  }

  /* void */ setDestination(/* DOMString */ address) {
    this.destination = address;
  }
}

class QuicTransport {
  constructor(/* boolean */ isServer, /* UdpTransport */ transport) {
    this.isServer = isServer;
    this.transport = transport;
    this.connected = false;
    this.localStreams = [];
    this.remoteStreams = [];
    this.remoteTransport = null;
    VN.transportsFrom[transport.getAddress()] = this;
    VN.transportsTo[transport.destination] = this;
  }

  /* QuicStream */ createStream() {
    // Add stream locally.
    var localStream = new QuicStream();
    this.localStreams.push(localStream);
    // If remote transport is ready, then notify it.
    var remoteTransport = VN.getTransportAt(this.transport.destination);
    if (remoteTransport && this.connected && remoteTransport.connected) {
      var remoteStream = new QuicStream();
      localStream.remote = remoteStream;
      remoteStream.remote = localStream;
      remoteTransport.remoteStreams.push(localStream);
      console.assert(this.localStreams.length == remoteTransport.remoteStreams.push());
      if (remoteTransport.onstream) {
        remoteTransport.onstream(localStream);
      }
    }
    return localStream;
  }

  /* attribute EventHandler onstream;  // QuicStream */

  /* void */ connect() {
    if (this.connected) {
      return;
    }
    this.connected = true;
    var remoteTransport = VN.getTransportAt(this.transport.destination);
    if (!remoteTransport || !remoteTransport.connected) {
      return;
    }
    this.remoteTransport = remoteTransport;
    remoteTransport.remoteTransport = this;
  }
}

class QuicStream {
  constructor() {
    this.buffer = "";
    this.finished = true;
    this.i = 0;
  }

  /* Promise */ waitForWritable(
      /* unsigned long */ amount,
      /* optional unsigned long */ maxBufferedAmount) {
    return Promise.resolve();
  }

  /* void */ write(/* Uint8Array */ data) {
    if (this.i++ % 2 == 0) {
      throw new Error();
    }
    this.remoteStream += data;
    if (this.onacked) {
      this.onacked();
    }
  }

  /* void */ finish(/* optional Uint8Array */ data) {
    this.finished = true;
    this.remoteStream.finished = true;
    this.write(data);
    if (this.onfinished) {
      this.onfinished();
    }
    if (this.remoteStream.onfinished) {
      this.remoteStream.onfinished();
    }
  }

  get /* boolean */ acked() {
    return true;
  }
  /* attribute EventHandler onacked */

  /* Uint8Array */ read() {
    var result = this.buffer;
    this.buffer = "";
    return result;
  }

  /* void */ readInto(/* Uint8Array */ data) {
    console.error("not implemented");
  }

  /* void */ close() {
    if (this.onclosed) {
      this.onclosed();
    }
  }
}
