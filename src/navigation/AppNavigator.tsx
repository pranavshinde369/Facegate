import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createStackNavigator} from '@react-navigation/stack';
import HomeScreen from '../screens/HomeScreen';
import EnrollScreen from '../screens/EnrollScreen';
import VerifyScreen from '../screens/VerifyScreen';
import ResultScreen from '../screens/ResultScreen';
import {VerificationResult} from '../types';

export type RootStackParamList = {
  Home: undefined;
  Enroll: undefined;
  Verify: undefined;
  Result: {result: VerificationResult};
};

const Stack = createStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: {backgroundColor: '#0A0A0A'},
          headerTintColor: '#FFFFFF',
          headerTitleStyle: {fontWeight: 'bold'},
          cardStyle: {backgroundColor: '#0A0A0A'},
        }}>
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="Enroll"
          component={EnrollScreen}
          options={{title: 'Enroll Agent'}}
        />
        <Stack.Screen
          name="Verify"
          component={VerifyScreen}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="Result"
          component={ResultScreen}
          options={{headerShown: false}}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}