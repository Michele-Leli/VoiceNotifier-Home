import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, SafeAreaView, StatusBar, AppState, Platform, Text, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import RNAndroidNotificationListener, { RNAndroidNotificationListenerHeadlessJsName } from 'react-native-android-notification-listener';
import * as Speech from 'expo-speech';
import GoogleCast, { CastContext, CastButton } from 'react-native-google-cast';

// L'URL del tuo server (quello che vedi nel browser)
const APP_URL = 'https://ais-dev-jfh3uddrk4c54zlzxxaaff-393424312334.europe-west2.run.app';

export default function App() {
  const webViewRef = useRef(null);
  const [hasPermission, setHasPermission] = useState(false);

  useEffect(() => {
    checkPermission();
    
    // Listener per le notifiche quando l'app è aperta
    const interval = setInterval(async () => {
      const status = await RNAndroidNotificationListener.getPermissionStatus();
      const authorized = status === 'authorized';
      if (authorized !== hasPermission) {
        setHasPermission(authorized);
        if (webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({ 
            type: 'NOTIF_PERMISSION_RESULT', 
            permission: authorized ? 'granted' : 'denied' 
          }));
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const checkPermission = async () => {
    const status = await RNAndroidNotificationListener.getPermissionStatus();
    setHasPermission(status === 'authorized');
  };

  const requestPermission = () => {
    RNAndroidNotificationListener.requestPermission();
  };

  // Funzione che riceve i messaggi dal WebView
  const onMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('Messaggio dal Web:', data);
      
      if (data.type === 'SHOW_CAST_PICKER') {
        console.log('Attivazione Cast Picker Nativo...');
        if (CastContext && typeof CastContext.showCastDialog === 'function') {
          CastContext.showCastDialog();
        } else {
          console.error('CastContext non disponibile o showCastDialog non è una funzione');
          alert("Funzione Cast non inizializzata. Riprova tra un istante.");
        }
      }

      if (data.type === 'REQUEST_NOTIF_PERMISSION') {
        console.log('Richiesta permessi notifiche...');
        RNAndroidNotificationListener.requestPermission();
      }

      if (data.type === 'START_LISTENING') {
        console.log('Richiesta avvio microfono (App)...');
        // Non intercettiamo più pesantemente, lasciamo che il web provi ad usare il microfono
        // Inviamo solo un segnale di conferma permessi
        webViewRef.current.postMessage(JSON.stringify({ type: 'MIC_PERMISSION_GRANTED' }));
      }
    } catch (e) {
      console.error('Errore parsing messaggio Web:', e);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#020617" />
      
      {!hasPermission && (
        <View style={styles.permissionBar}>
          <Text style={styles.permissionText}>Accesso notifiche necessario</Text>
          <TouchableOpacity onPress={requestPermission} style={styles.permissionButton}>
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
        allowsFullscreenVideo={true}
        userAgent="VoxHomeBridgeExpo"
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
        originWhitelist={['*']}
        onPermissionRequest={(event) => {
          console.log('Permission Request:', event.permission);
          event.grant(event.permission);
        }}
      />
      
      {/* Il CastButton deve essere presente nell'albero per far funzionare showCastDialog su Android, lo nascondiamo con dimensione minima */}
      <View style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }}>
        <CastButton style={{ width: 1, height: 1 }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  webview: {
    flex: 1,
    backgroundColor: '#020617',
  },
  permissionBar: {
    backgroundColor: '#1e293b',
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  permissionText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: 'bold',
  },
  permissionButton: {
    backgroundColor: '#22d3ee',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  buttonText: {
    color: '#020617',
    fontSize: 10,
    fontWeight: '900',
  }
});
