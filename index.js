import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import App from './App';

// Questa funzione viene eseguita OGNI VOLTA che arriva una notifica, anche in background
const headlessNotificationListener = async ({ notification }) => {
    if (notification) {
        console.log('Notifica ricevuta in background:', notification);
        
        // Qui inviamo la notifica al tuo server o la processiamo
        // Esempio: invia al webhook che abbiamo configurato
        try {
            const data = JSON.parse(notification);
            await fetch('https://ais-dev-jfh3uddrk4c54zlzxxaaff-393424312334.europe-west2.run.app/api/webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    app: data.app || data.package || 'App',
                    title: data.title || '',
                    message: data.text || '',
                    timestamp: Date.now()
                })
            });
        } catch (e) {
            console.error('Errore nel processare la notifica background:', e);
        }
    }
};

// Registra l'ascoltatore di background
AppRegistry.registerHeadlessTask(
    'RNAndroidNotificationListenerHeadlessJsName',
    () => headlessNotificationListener
);

// Registra l'app principale
registerRootComponent(App);
