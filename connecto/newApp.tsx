import {
  Button,
  DevSettings,
  Image,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import React, {useEffect, useState, useRef, useCallback} from 'react';
import {io} from 'socket.io-client';
import {Dimensions} from 'react-native';
import * as mediaSoupClient from 'mediasoup-client';
import {
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
  registerGlobals,
  RTCView,
} from 'react-native-webrtc';
const {height, width} = Dimensions.get('screen');
import {
  useCameraPermission,
  Camera,
  useCameraDevice,
  useFrameProcessor,
} from 'react-native-vision-camera';
import ViewShot from 'react-native-view-shot';
const socket = io(
  'https://71cb-2405-201-4018-9231-f1d3-6fd5-edf9-c32d.ngrok-free.app',
);

registerGlobals();
let params: any = {
  // mediasoup params
  encodings: [
    {
      rid: 'r0',
      maxBitrate: 100000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r1',
      maxBitrate: 300000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r2',
      maxBitrate: 900000,
      scalabilityMode: 'S1T3',
    },
  ],
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};

function extractFrame(frame: Frame): {
  worklet;
};
const App = () => {
  const rtpCapabilities = useRef<any>();
  const deviceRef = useRef<any>(undefined);
  const producerTransport = useRef<any>();
  const consumerTransport = useRef<any>();
  const producerRef = useRef<any>();
  const consumerRef = useRef<any>();

  const isProducer = useRef<any>(false);
  const [localStream, setLocalStream] = useState<any>();
  const [remoteStream, setRemoteStream] = useState<any>();
  const [videoFrame, setVideoFrame] = useState<any>(null);
  const [url, setUrl] = useState<any>();
  const ref = useRef<any>();
  //react native vision camera

  const {hasPermission, requestPermission} = useCameraPermission();

  const frameProcessor = useFrameProcessor(frame => {
    'worklet';
    const data = frame.toArrayBuffer();
    console.log(data[0], 'dd');
  }, []);

  const device: any = useCameraDevice('front');

  useEffect(() => {
    console.log(videoFrame);
  }, [videoFrame]);
  useEffect(() => {
    socket.on('connection-successfull', data => {
      console.log('Connection Successfull', data.socketId, data.existProducer);
    });
    requestPermission();
  }, []);

  const getRtpCapabilities = () => {
    socket.emit('createRoom', (rtpCapabilities: any) => {
      console.log(rtpCapabilities, 'rtpcapabilities');
      // setting ref to use it later,setting it becauase it shudnt get lost
      rtpCapabilities.current = rtpCapabilities.rtpCapabilities;
      getDevice();
    });
  };
  const getDevice = async () => {
    try {
      deviceRef.current = new mediaSoupClient.Device(); //device is created
      await deviceRef.current.load({
        routerRtpCapabilities: rtpCapabilities.current,
      });
      console.log(rtpCapabilities, 'rtpcurrent');
      goCreateTransport();
    } catch (err) {
      console.log(err);
    }
  };

  const goCreateTransport = () => {
    isProducer.current ? createSendTransport() : createreceiveTransport();
  };

  const goConnect = async (producerOrConsumer: any) => {
    console.log('setting producer to true', producerOrConsumer);
    isProducer.current = producerOrConsumer;
    deviceRef.current === undefined
      ? getRtpCapabilities()
      : goCreateTransport();
  };

  const goConsume = async () => {
    goConnect(false);
  };

  const getLocalStream = async () => {
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: {
        mandatory: {minFrameRate: 30},
        facingMode: 'user',
      },
    });
    setLocalStream(stream);
    const track = stream.getVideoTracks()[0];

    params = {track, ...params};
    goConnect(true);
  };

  const createSendTransport = async () => {
    console.log('createSendTransport');
    try {
      socket.emit('createWebrtcTransport', {sender: true}, (data: any) => {
        if (data.err) {
          console.log(data.err, 'error occurred from creating transport ');
          return;
        }
        console.log(data.params, 'ddd');
        //creates a new webrtc transpport to send media ,based on servers producer
        // transport params
        producerTransport.current = deviceRef.current.createSendTransport(
          data.params,
        );
        producerTransport.current.on(
          'connect',
          async ({dtlsParameters}: any, callback: any, errorBack: any) => {
            try {
              console.log(dtlsParameters, 'nooooo');
              await socket.emit('transport-connect', {dtlsParameters});
              callback();
            } catch (err) {
              errorBack(err);
            }
          },
        );

        producerTransport.current.on(
          'produce',
          async (parameters: any, callback: any, errorBack: any) => {
            try {
              // telling the server to create a producer with the following parameter
              //expect back a server side producer id
              socket.emit(
                'transport-produce',
                {
                  kind: parameters.kind,
                  rtpParameters: parameters.rtpParameters,
                  appData: parameters.appData,
                },

                ({id}: any) => {
                  //tells the transport that parameters are transmitted provided with server side producer id
                  callback({id});
                },
              );
            } catch (err) {}
          },
        );
        console.log(data.params);
        connectSendTransport();
      });
    } catch (err) {
      console.log(err);
    }
  };

  const connectSendTransport = async () => {
    try {
      console.log(params, 'capturing params');

      producerRef.current = await producerTransport.current.produce(params);
      //media getting produced
      producerRef.current.on('trackended', () => {
        console.log('Track ended');
      });
      producerRef.current.on('transportclosed', () => {
        console.log('transport ended');
      });
    } catch (err) {
      console.log(err);
    }
  };

  const createreceiveTransport = async () => {
    await socket.emit('createWebrtcTransport', {sender: false}, (data: any) => {
      if (data.err) {
        console.log(params.err);
        return;
      }
      consumerTransport.current = deviceRef.current.createRecvTransport(
        data.params,
      );
      consumerTransport.current.on(
        'connect',
        ({dtlsParameters}: any, callback: any, errorBack: any) => {
          try {
            socket.emit('transport-recv-connect', {dtlsParameters});
            callback();
          } catch (err) {
            errorBack(err);
          }
        },
      );
      connectReceiveTransport();
    });
  };
  const connectReceiveTransport = async () => {
    try {
      socket.emit(
        'consumer',
        {
          rtpCapabilities: deviceRef.current.rtpCapabilities,
        },
        async (data: any) => {
          if (data.err) {
            console.log(data.err, 'consumer error');
            return;
          }
          console.log(data, '################################');
          consumerRef.current = await consumerTransport.current.consume({
            id: data.params.id,
            kind: data.params.kind,
            producerId: data.params.producerId,
            rtpParameters: data.params.rtpParameters,
          });
          const mediaTrack = consumerRef.current as any;
          let remoteStream = new MediaStream([mediaTrack.track]);
          console.log(remoteStream, 'remotestream---------------------');
          setRemoteStream(remoteStream);
          socket.emit('consumer-resumed');
        },
      );
    } catch (err) {
      console.log(err);
    }
  };
  const onError = useCallback(e => {
    console.log(e);
  }, []);
  if (device === null) {
    return <View />;
  }
  const onCapture = uri => {
    console.log('do something with ', uri);
  };
  console.log(url, 'url');

  // MediaStreamTrack.;

  return (
    <View>
      <Text>hello mediasoup</Text>
      {/* <Camera
        device={device}
        isActive={true}
        onError={onError}
        style={{marginLeft: 80, height: 300, width: 200, marginBottom: 20}}
        frameProcessor={frameProcessor}
      /> */}
      <Button
        title="produce"
        onPress={() => {
          getLocalStream();
        }}
      />
      <Button
        title="Consume"
        onPress={() => {
          goConsume();
        }}
      />
      {/* <Button
        title="GetLocalStream"
        onPress={() => {
          getLocalStream();
        }}
      />

      <Button
        title="GetRtpCapabilities"
        onPress={() => {
          getRtpCapabilities();
        }}
      />
      <Button
        title="GetDevice"
        onPress={() => {
          getDevice();
        }}
      />
      <Button
        title="GetProducer"
        onPress={() => {
          createSendTransport();
        }}
      />
      <Button
        title="connectsendtransport"
        onPress={() => connectSendTransport()}
      />
      <Button
        title="createreceivetransport"
        onPress={() => createreceiveTransport()}
      />
      <Button
        title="connectreceivetransport"
        onPress={connectReceiveTransport}
      /> */}
      <ViewShot ref={ref}>
        <View style={{backgroundColor: 'blue', width: 100, height: 20}}>
          <RTCView
            streamURL={localStream?.toURL()}
            objectFit="cover"
            style={{width: width, height: height * 0.4}}
          />
        </View>
      </ViewShot>

      {/* <RTCView
        objectFit="cover"
        streamURL={remoteStream?.toURL()}
        style={{width: width, height: height * 0.4}}
      /> */}

      {url && <Image source={{uri: url}} style={{height: 20, width: 200}} />}
      <Button
        title="capture"
        onPress={() =>
          ref.current.capture().then(uri => {
            setUrl(uri);
          })
        }
      />
    </View>
  );
};

export default App;

const styles = StyleSheet.create({});
