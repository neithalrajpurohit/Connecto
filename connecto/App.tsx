import {
  Button,
  DevSettings,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import React, {useEffect, useState, useRef} from 'react';
import {io} from 'socket.io-client';
import * as mediaSoupClient from 'mediasoup-client';
import {
  mediaDevices,
  MediaStream,
  registerGlobals,
  RTCView,
} from 'react-native-webrtc';
import {
  useCameraPermission,
  Camera,
  useCameraDevice,
  useFrameProcessor,
} from 'react-native-vision-camera';

const socket = io('http://192.168.29.17:3000');

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

const App = () => {
  const rtpCapabilities = useRef<any>();
  const deviceRef = useRef<any>();
  const producerTransport = useRef<any>();
  const consumerTransport = useRef<any>();
  const producerRef = useRef<any>();
  const consumerRef = useRef<any>();

  const [localStream, setLocalStream] = useState<any>();
  const [remoteStream, setRemoteStream] = useState<any>();
  const [videoFrame, setVideoFrame] = useState<any>(null);

  //react native vision camera

  const {hasPermission, requestPermission} = useCameraPermission();
  const frameProcessor = useFrameProcessor(frame => {
    'worklet';

    setVideoFrame(frame);
  }, []);
  const device: any = useCameraDevice('front');
  console.log(videoFrame, 'vv');

  if (device === null) {
    return <View />;
  }
  useEffect(() => {
    console.log(videoFrame);
  }, [videoFrame]);
  useEffect(() => {
    socket.on('connection-successfull', socketId => {
      console.log('Connection Successfull', socketId);
    });
    requestPermission();
  }, []);

  const getRtpCapabilities = () => {
    socket.emit('getrtpcapabilities', (data: any) => {
      console.log(data, 'rtpcapabilities');
      // setting ref to use it later,setting it becauase it shudnt get lost
      rtpCapabilities.current = data.rtpCapabilities;
    });
  };
  const getDevice = async () => {
    try {
      deviceRef.current = new mediaSoupClient.Device(); //device is created
      await deviceRef.current.load({
        routerRtpCapabilities: rtpCapabilities.current,
      });
      console.log(rtpCapabilities, 'rtpcurrent');
    } catch (err) {
      console.log(err);
    }
  };
  const getLocalStream = async () => {
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: {
        mandatory: {minWidth: 500, maxWidth: 300, minFrameRate: 30},
        facingMode: 'user',
      },
    });
    setLocalStream(stream);
    const track = stream.getVideoTracks()[0];

    params = {track, ...params};
  };
  const createSendTransport = async () => {
    try {
      socket.emit('createWebrtcTransport', {sender: true}, (data: any) => {
        if (data.err) {
          console.log(data.err, 'error occurred from creating transport ');
          return;
        }
        console.log(data.params, 'ddd');
        //creates a new webrtc transpport to send media ,based on servers producer transport params
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
          consumerRef.current = await consumerTransport.current.consume({
            id: data.params.id,
            kind: data.params.kind,
            producerId: data.params.producerId,
            rtpParameters: data.params.rtpParameters,
          });
          const mediaTrack = consumerRef.current as any;
          let remoteStream = new MediaStream([mediaTrack.track]);
          console.log(remoteStream, 'remotestream');
          setRemoteStream(remoteStream);
          socket.emit('consumer-resumed');
        },
      );
    } catch (err) {
      console.log(err);
    }
  };

  return (
    <View>
      <Text>hello mediasoup</Text>
      <Camera
        device={device}
        isActive={true}
        style={{marginLeft: 80, height: 300, width: 200, marginBottom: 20}}
        frameProcessor={frameProcessor}
      />
      <Button
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
      />
      <RTCView
        streamURL={localStream?.toURL()}
        style={{width: 400, height: 200}}
      />
      <RTCView
        streamURL={remoteStream?.toURL()}
        style={{width: 400, height: 200}}
      />
    </View>
  );
};

export default App;

const styles = StyleSheet.create({});
