import React, {useEffect} from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {PermissionsAndroid, Platform, Alert} from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';

const requestCameraPermission = async () => {
  if (Platform.OS === 'android') {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'FaceGate Camera Permission',
          message:
            'FaceGate needs camera access for face recognition. ' +
            'All processing happens offline on your device.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'Allow',
        },
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert(
          'Camera Required',
          'FaceGate needs camera permission to work.',
        );
      }
    } catch (err) {
      console.warn('Permission error:', err);
    }
  }
};

export default function App() {
  useEffect(() => {
    requestCameraPermission();
  }, []);

  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <SafeAreaProvider>
        <AppNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}