import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, SafeAreaView, StatusBar, Text, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GoogleCast, { CastContext, CastButton } from 'react-native-google-cast';

const APP_URL = 'https://ais-dev-jfh3uddrk4c54zlzxxaaff-393424312334.europe-west2.run.app';

export default function App() {
  const webViewRef = useRef(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [isReadingEnabled, setIsReadingEnabled] = useState(true);

  // Funzione audio interna per evitare errori di riferimento
  const eseguiLettura = async (testo) => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        interruptionModeAndroid: 1,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      await Speech.stop();
      Speech.speak(testo, { language: 'it-IT', pitch: 1.0, rate: 1.0 });
    } catch (e) {
      console.log("Errore Audio:", e);
    }
  };

  useEffect(() => {
    // 1. Carica preferenze
    AsyncStorage.getItem('READING_ENABLED').then(val => {
      if (val !== null) setIsReadingEnabled(val === 'true');
    });

    // 2. LISTENER NOTIFICHE
    const subscription = RNAndroidNotificationListener.subscribe((notification) => {
      // Invia alla WebView
      webViewRef.current?.postMessage(JSON.stringify({ type: 'NOTIF', data: notification }));

      // LEGGI (Usa il valore corrente dello stato)
      if (isReadingEnabled) {
        const messaggio = `Notifica da ${notification.title || notification.app}: ${notification.text}`;
        eseguiLettura(messaggio);
      }
    });

    return () => subscription.remove();
  }, [isReadingEnabled]); // Importante: si aggiorna se cambi il tasto

  const onMessage = async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'SET_READING_STATE') {
        setIsReadingEnabled(data.enabled);
        await AsyncStorage.setItem('READING_ENABLED', data.enabled.toString());
      }
      if (data.type === 'SPEAK') eseguiLettura(data.text);
      if (data.type === 'SHOW_CAST_PICKER') CastContext.showCastDialog();
    } catch (e) { console.error(e); }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#020617" />
      <WebView 
        ref={webViewRef} 
        source={{ uri: APP_URL }} 
        onMessage={onMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
      />
      <View style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }}>
        <CastButton style={{ width: 1, height: 1 }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617' },
});
