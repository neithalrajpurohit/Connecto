import express from "express";
import { createServer } from "http"; //express server
import { Server } from "socket.io"; //socket server
import mediasoup from "mediasoup";

const app = express();
const options = {};
const httpServer = createServer(app);
const io = new Server(httpServer, { options }); //setting socket server which returns io .io on which events like on,emit are performed
const port = 3000;

let worker;
let router;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

// Creation of Worker
const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMaxPort: 2020,
    rtcMinPort: 2010,
  });
  console.log(worker.pid); //pid is process id

  // when the browser is closed worker gets disconnected
  worker.on("died", (err) => {
    console.log("mediasoup worker has closed");
  });
  return worker;
};
worker = createWorker();

// mediacodecs -->keeps the metadata related to audio and videos
const mediacodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

// setting up connection
//io.emit sends the info to all the sockets connected

io.on("connection", async (socket) => {
  console.log(socket.id);
  socket.emit("connection-successfull", {
    socketId: socket.id,
    existProducer: producer ? true : false,
  });

  // creating a router
  // rtpcapabilities delivers real time audio and video thru ipnetworks
  router = await worker.createRouter({ mediaCodecs: mediacodecs }); //takes mediacodecs and returns rtpcapabilities

  const getRtpCapabilities = (callback) => {
    const rtpCapabilities = router.rtpCapabilities;
    callback({ rtpCapabilities });
  };
  socket.on("createRoom", (callback) => {
    if (router === undefined) {
      const rtpCapabilities = router.rtpCapabilities;
      console.log(rtpCapabilities);
    }
    getRtpCapabilities(callback);
  });
  // creating a transport
  // If sender is true it is a producer,when it becomes false it becomes consumer
  socket.on("createWebrtcTransport", async ({ sender }, callback) => {
    if (sender) {
      producerTransport = await createWebrtcTransport(callback);
    } else {
      consumerTransport = await createWebrtcTransport(callback);
    }
  });

  //connected through producer transport
  socket.on("transport-connect", async ({ dtlsParameters }) => {
    console.log(dtlsParameters, "dtls");
    await producerTransport.connect({ dtlsParameters });
  });
  socket.on(
    "transport-produce",
    async ({ kind, rtpParameters, appData }, callback) => {
      producer = await producerTransport.produce({ kind, rtpParameters });
      console.log(producer.id, producer.kind, "producer id");
      producer.on("transportclose", () => {
        console.log("transport for this producer is closed");
        producer.close();
      });
      callback({ id: producer.id });
    }
  );

  socket.on("transport-recv-connect", async ({ dtlsParameters }) => {
    await consumerTransport.connect({ dtlsParameters });
  });
  socket.on("consumer", async (data, callback) => {
    try {
      if (
        router.canConsume({
          producerId: producer.id,
          rtpCapabilities: data.rtpCapabilities,
        })
      ) {
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities: data.rtpCapabilities,
          paused: true,
        });
        consumer.on("transportclose", () => {
          console.log("transport closed from consumer");
        });
        consumer.on("producerclose", () => {
          console.log("producer closed from consumer");
        });
        const params = {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        };
        callback({ params });
      }
    } catch (err) {
      console.log(err);
    }
  });
  socket.on("consumer-resumed", async () => {
    await consumer.resume();
  });
});

httpServer.listen(port, () => {
  console.log(`listening to port ${port}`);
});

const createWebrtcTransport = async (callback) => {
  //webrtc transport options

  try {
    const webRtcTransport_options = {
      listenIps: [
        {
          ip: "0.0.0.0",
          announcedIp: "192.168.29.17",
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };

    // createWebrtcTransport ->generates an transport id
    let transport = await router.createWebRtcTransport(webRtcTransport_options);
    console.log(`transport id:${transport.id}`);
    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        transport.close();
      }
    });
    transport.on("close", () => {
      console.log("transport closed");
    });
    //sending back to the client the following parameters
    // iceparams and candidates are nothung but used to establish connection between
    // 2 peers
    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    });

    return transport;
  } catch (err) {
    console.log(err);
    callback({
      params: {
        err: err,
      },
    });
  }
};
