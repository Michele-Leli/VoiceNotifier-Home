import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, SafeAreaView, StatusBar, Text, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import * as Speech from 'expo-speech';
import GoogleCast, { CastContext, CastButton } from 'react-native-google-cast';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

const APP_URL = 'https://ais-dev-jfh3uddrk4c54zlzxxaaff-393424312334.europe-west2.run.app';

export default function App() {
  const webViewRef = useRef(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [isReadingEnabled, setIsReadingEnabled] = useState(true); // Stato locale per la lettura

  // 1. Funzione per la lettura vocale (portata dentro o resa accessibile)
  const eseguiLettura = async (testo) => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        interruptionModeAndroid: 1,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const isSpeaking = await Speech.isSpeakingAsync();
      if (isSpeaking) await Speech.stop();

      console.log("🗣️ Lettura in corso:", testo);
      Speech.speak(testo, {
        language: 'it-IT',
        pitch: 1.0,
        rate: 1.0,
      });
    } catch (error) {
      console.error("❌ Errore Audio:", error);
    }
  };

  useEffect(() => {
    checkPermission();

    // 1. Carichiamo lo stato del pulsante salvato
    AsyncStorage.getItem('READING_ENABLED').then(val => {
      if (val !== null) setIsReadingEnabled(val === 'true');
    });

    // 2. Registriamo l'ascoltatore per le notifiche (IL PEZZO MANCANTE)
    const subscription = RNAndroidNotificationListener.subscribe((notification) => {
      console.log("📩 Notifica intercettata:", notification.app);

      // Invia alla WebView per lo storico
      webViewRef.current?.postMessage(JSON.stringify({ 
        type: 'NOTIFICATION_RECEIVED', 
        notification: notification 
      }));

      // LEGGI AD ALTA VOCE solo se il pulsante è ON
      if (isReadingEnabled) {
        const testo = `Notifica da ${notification.title || notification.app}: ${notification.text}`;
        // Forza il risveglio dell'audio prima di parlare
        Audio.setAudioModeAsync({ staysActiveInBackground: true, interruptionModeAndroid: 1 });
        Speech.speak(testo, { language: 'it-IT' });
      }
    });

    // --- GESTIONE CAST ---
    const castSessionManager = GoogleCast.getSessionManager();
    const subs = [
      castSessionManager.onSessionStarted((s) => updateCastStatus(true, s.device?.friendlyName)),
      castSessionManager.onSessionResumed((s) => updateCastStatus(true, s.device?.friendlyName)),
      castSessionManager.onSessionEnded(() => updateCastStatus(false))
    ];

    return () => {
      subscription.remove();
      subs.forEach(s => s.remove());
    };
  }, [isReadingEnabled]); // Ricarica il listener se cambia lo stato del tasto

  const updateCastStatus = (isCasting, deviceName = '') => {
    webViewRef.current?.postMessage(JSON.stringify({ 
      type: 'CAST_STATE_CHANGED', isCasting, deviceName 
    }));
  };

  const checkPermission = async () => {
    const status = await RNAndroidNotificationListener.getPermissionStatus();
    setHasPermission(status === 'authorized');
  };

  const onMessage = async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      switch (data.type) {
        case 'SHOW_CAST_PICKER':
          CastContext.showCastDialog();
          break;
        case 'REQUEST_NOTIF_PERMISSION':
          RNAndroidNotificationListener.requestPermission();
          break;
        case 'SPEAK':
          eseguiLettura(data.text || data.message);
          break;
        case 'SET_READING_STATE':
          console.log("🔄 Cambio stato lettura:", data.enabled);
          setIsReadingEnabled(data.enabled);
          await AsyncStorage.setItem('READING_ENABLED', data.enabled.toString());
          break;
        case 'GET_STATES':
          const status = await RNAndroidNotificationListener.getPermissionStatus();
          webViewRef.current.postMessage(JSON.stringify({ 
            type: 'STATE_UPDATE', 
            isReadingActive: isReadingEnabled,
            permission: status === 'authorized' ? 'granted' : 'denied'
          }));
          break;
      }
    } catch (e) {
      console.error('Errore Web Message:', e);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#020617" />
      
      {!hasPermission && (
        <View style={styles.permissionBar}>
          <Text style={styles.permissionText}>Accesso notifiche necessario</Text>
          <TouchableOpacity onPress={() => RNAndroidNotificationListener.requestPermission()} style={styles.permissionButton}>
            <Text style={styles.buttonText}>AUTORIZZA</Text>
          </TouchableOpacity>
        </View>
      )}

      <WebView
        ref={webViewRef}
        source={{ uri: APP_URL }}
        style={styles.webview}
        onMessage={onMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        userAgent="VoxHomeBridgeExpo"
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
      />
      
      <View style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }}>
        <CastButton style={{ width: 1, height: 1 }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617' },
  webview: { flex: 1, backgroundColor: '#020617' },
  permissionBar: { 
    backgroundColor: '#1e293b', padding: 10, flexDirection: 'row', 
    justifyContent: 'space-between', alignItems: 'center' 
  },
  permissionText: { color: '#cbd5e1', fontSize: 12, fontWeight: 'bold' },
  permissionButton: { backgroundColor: '#22d3ee', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  buttonText: { color: '#020617', fontSize: 10, fontWeight: '900' }
});
