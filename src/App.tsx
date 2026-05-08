/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { 
  Bell, 
  Settings, 
  Cast, 
  Volume2, 
  CheckCircle2, 
  Smartphone, 
  Home,
  Plus,
  Trash2,
  Play,
  Activity,
  Mic2,
  Search,
  X,
  Info,
  Clock,
  Calendar,
  Lock,
  Moon,
  Sun,
  Wifi
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Notification {
  app: string;
  title: string;
  message: string;
  timestamp: number;
}

interface AppConfig {
  name: string;
  enabled: boolean;
}

interface Schedule {
  id: string;
  days: number[]; // 0-6 (Domenica-Sabato)
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  enabled: boolean;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"home" | "settings">("home");
  const [bridgeLogs, setBridgeLogs] = useState<string[]>([]);
  const [isInApp, setIsInApp] = useState(false);
  const isInAppRef = useRef(false);

  useEffect(() => {
    const checkInApp = () => {
      const isUA = typeof navigator !== 'undefined' && navigator.userAgent.includes('VoxHomeBridgeExpo');
      const isWV = typeof window !== 'undefined' && (window as any).ReactNativeWebView;
      const result = !!(isUA || isWV);
      setIsInApp(result);
      isInAppRef.current = result;
    };
    checkInApp();
    const timer = setInterval(checkInApp, 2000);
    return () => clearInterval(timer);
  }, []);

  const addLog = (msg: string) => {
    setBridgeLogs(prev => [msg, ...prev].slice(0, 20));
  };
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isReadingActive, setIsReadingActive] = useState(() => localStorage.getItem("voiceNotifier_active") === "true");
  const [isListening, setIsListening] = useState(false);
  
  // Schedulazione
  const [schedules, setSchedules] = useState<Schedule[]>(() => {
    const saved = localStorage.getItem("voiceNotifier_schedules");
    if (saved) {
      try { return JSON.parse(saved); } catch(e) { return []; }
    }
    return [];
  });
  const [isWakeLockActive, setIsWakeLockActive] = useState(false);
  const wakeLockRef = useRef<any>(null);
  const [homeWifiName, setHomeWifiName] = useState(() => localStorage.getItem("voiceNotifier_homeWifi") || "");
  const [onlyOnHomeWifi, setOnlyOnHomeWifi] = useState(() => localStorage.getItem("voiceNotifier_onlyHomeWifi") === "true");
  const [availableApps, setAvailableApps] = useState<string[]>(["WhatsApp", "VoxHome Bridge", "IFTTT", "Telegram", "Gmail", "Instagram", "Slack", "Discord", "Messenger", "Facebook", "TikTok", "Snapchat", "LinkedIn", "Outlook", "Amazon", "YouTube", "Spotify", "Netflix", "Uber", "Deliveroo", "Glovo", "Amazon Alexa", "Google Home", "Ring", "Arlo", "Twitter", "Reddit", "PayPal", "eBay", "Twitch", "Bumble", "Tinder", "Strava", "Garmin Connect", "Trello", "Asana", "Zoom", "Microsoft Teams"]);
  const [showAppModal, setShowAppModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  
  const [allowedApps, setAllowedApps] = useState<AppConfig[]>(() => {
    const saved = localStorage.getItem("voiceNotifier_apps");
    const defaultApps = [
      { name: "WhatsApp", enabled: true },
      { name: "VoxHome Bridge", enabled: true },
      { name: "Telegram", enabled: true },
      { name: "Gmail", enabled: true }
    ];
    
    if (!saved) return defaultApps;
    
    try {
      const parsed = JSON.parse(saved);
      // Ensure VoxHome Bridge is in the list of allowed apps
      if (!parsed.find((a: any) => a.name.toLowerCase() === "voxhome bridge")) {
        return [...parsed, { name: "VoxHome Bridge", enabled: true }];
      }
      return parsed;
    } catch (e) {
      return defaultApps;
    }
  });
  const [volume, setVolume] = useState(() => Number(localStorage.getItem("voiceNotifier_volume") || 50));
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );

  const requestNotifPermission = async () => {
    if (isInApp && (window as any).ReactNativeWebView) {
      addLog("SND: REQ_NOTIF_PERM");
      (window as any).ReactNativeWebView.postMessage(JSON.stringify({ type: 'REQUEST_NOTIF_PERMISSION' }));
      return "default"; // Will be updated by native side
    }

    if (typeof Notification !== "undefined") {
      const permission = await Notification.requestPermission();
      setNotifPermission(permission);
      return permission;
    }
    return "default";
  };

  const [voiceLang, setVoiceLang] = useState(() => localStorage.getItem("voiceNotifier_voice") || "it-IT");
  const [isCasting, setIsCasting] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [isMicWindowActive, setIsMicWindowActive] = useState(false);
  const [newAppInput, setNewAppInput] = useState("");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");

  const castSessionRef = useRef<any>(null);
  const recognitionRef = useRef<any>(null);
  const notificationsRef = useRef<Notification[]>([]);
  const isReadingActiveRef = useRef(isReadingActive);
  const unreadCountRef = useRef(unreadCount);
  const isCastingRef = useRef(isCasting);
  const pendingActionRef = useRef<{ type: "read", count: number } | null>(null);
  const isMicWindowActiveRef = useRef(false);
  const listeningTimerRef = useRef<NodeJS.Timeout | null>(null);
  const allowedAppsRef = useRef(allowedApps);
  const onlyOnHomeWifiRef = useRef(onlyOnHomeWifi);

  useEffect(() => { onlyOnHomeWifiRef.current = onlyOnHomeWifi; }, [onlyOnHomeWifi]);

  const checkWiFiAccess = () => {
    if (!onlyOnHomeWifiRef.current) return true;
    const conn = (navigator as any).connection;
    // Se non possiamo rilevare la connessione, permettiamo (per evitare blocchi su browser vecchi)
    if (!conn) return true;
    
    // Su Chrome/Android conn.type può essere 'wifi', 'cellular', etc.
    if (conn.type && conn.type !== 'wifi' && conn.type !== 'unknown') {
      return false;
    }
    return true;
  };

  // Keep refs in sync for callbacks
  useEffect(() => { notificationsRef.current = notifications; }, [notifications]);
  useEffect(() => { isReadingActiveRef.current = isReadingActive; }, [isReadingActive]);
  useEffect(() => { unreadCountRef.current = unreadCount; }, [unreadCount]);
  useEffect(() => { isCastingRef.current = isCasting; }, [isCasting]);
  useEffect(() => { allowedAppsRef.current = allowedApps; }, [allowedApps]);

  useEffect(() => {
    localStorage.setItem("voiceNotifier_schedules", JSON.stringify(schedules));
  }, [schedules]);

  useEffect(() => {
    localStorage.setItem("voiceNotifier_homeWifi", homeWifiName);
    localStorage.setItem("voiceNotifier_onlyHomeWifi", onlyOnHomeWifi.toString());
  }, [homeWifiName, onlyOnHomeWifi]);

  // Wake Lock for Android Persistence
  const toggleWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        if (!isWakeLockActive) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          setIsWakeLockActive(true);
          console.log("Wake Lock attivato: l'app resterà attiva in background");
        } else {
          if (wakeLockRef.current) {
            await wakeLockRef.current.release();
            wakeLockRef.current = null;
          }
          setIsWakeLockActive(false);
          console.log("Wake Lock disattivato");
        }
      } catch (err) {
        console.error("Errore Wake Lock:", err);
      }
    } else {
      alert("Wake Lock non supportato su questo browser");
    }
  };

  // Schedulatore: controlla ogni minuto
  useEffect(() => {
    const checkSchedules = () => {
      if (schedules.length === 0) return;

      const now = new Date();
      const currentDay = now.getDay();
      const currentHours = now.getHours();
      const currentMins = now.getMinutes();
      const currentTimeStr = `${currentHours.toString().padStart(2, '0')}:${currentMins.toString().padStart(2, '0')}`;

      let shouldBeActive = false;

      schedules.forEach(schedule => {
        if (!schedule.enabled) return;
        
        if (schedule.days.includes(currentDay)) {
          // Gestione intervallo (es 22:00 - 07:00)
          if (schedule.startTime <= schedule.endTime) {
            if (currentTimeStr >= schedule.startTime && currentTimeStr < schedule.endTime) {
              shouldBeActive = true;
            }
          } else {
            // Intervallo che scavalca la mezzanotte
            if (currentTimeStr >= schedule.startTime || currentTimeStr < schedule.endTime) {
              shouldBeActive = true;
            }
          }
        }
      });

      // Applica solo se c'è un cambiamento e non stiamo forzando manualmente qualcosa? 
      // In realtà lo schedulatore domina se attivo.
      if (shouldBeActive !== isReadingActiveRef.current) {
        console.log(`Schedulatore: Cambio stato in ${shouldBeActive ? 'ATTIVO' : 'DISATTIVO'}`);
        setIsReadingActive(shouldBeActive);
      }
    };

    const interval = setInterval(checkSchedules, 60000); // Controlla ogni minuto
    checkSchedules(); // Esegui subito all'avvio

    return () => clearInterval(interval);
  }, [schedules]);

  // Persistence
  useEffect(() => {
    localStorage.setItem("voiceNotifier_apps", JSON.stringify(allowedApps));
  }, [allowedApps]);

  const addSchedule = () => {
    const newSchedule: Schedule = {
      id: Math.random().toString(36).substr(2, 9),
      days: [1, 2, 3, 4, 5],
      startTime: "08:00",
      endTime: "22:00",
      enabled: true
    };
    setSchedules(prev => [...prev, newSchedule]);
  };

  const updateSchedule = (id: string, updates: Partial<Schedule>) => {
    setSchedules(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const removeSchedule = (id: string) => {
    setSchedules(prev => prev.filter(s => s.id !== id));
  };

  const toggleDayInSchedule = (id: string, day: number) => {
    setSchedules(prev => prev.map(s => {
      if (s.id !== id) return s;
      const newDays = s.days.includes(day) 
        ? s.days.filter(d => d !== day)
        : [...s.days, day].sort();
      return { ...s, days: newDays };
    }));
  };
  
  // Ascolto messaggi di toggle da SW/BC (Ripristinato)
  useEffect(() => {
    const handleToggleMessage = (event: any) => {
      const data = event.data;
      if (data && data.type === 'TOGGLE_READING') {
        setIsReadingActive(data.enabled);
      }
    };
    const bc = new BroadcastChannel('voxhome_notifications');
    bc.addEventListener('message', handleToggleMessage);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleToggleMessage);
    }
    return () => {
      bc.removeEventListener('message', handleToggleMessage);
      bc.close();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleToggleMessage);
      }
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("voiceNotifier_volume", volume.toString());
  }, [volume]);

  useEffect(() => {
    localStorage.setItem("voiceNotifier_voice", voiceLang);
  }, [voiceLang]);

  useEffect(() => {
    localStorage.setItem("voiceNotifier_active", isReadingActive.toString());

    // Sincronizza lo stato con la parte nativa Android
    if (isInApp && (window as any).ReactNativeWebView) {
      addLog("SND: SET_READ_STATE " + isReadingActive);
      (window as any).ReactNativeWebView.postMessage(JSON.stringify({ 
        type: 'SET_READING_STATE', 
        enabled: isReadingActive 
      }));
    }

    if (isReadingActive) {
      // Force a speech priming on activation to help mobile browsers keep the engine warm
      speakLocally("Voce attiva").catch(() => {});
    }
  }, [isReadingActive]);

  // Richiesta stati iniziali all'avvio (Handshake con Native)
  useEffect(() => {
    if (isInApp) {
      console.log("App: Tentativo Handshake con Native...");
      const sendHandshake = () => {
        if ((window as any).ReactNativeWebView) {
          addLog("SND: GET_STATES");
          console.log("App: Invio GET_STATES a Native");
          (window as any).ReactNativeWebView.postMessage(JSON.stringify({ type: 'GET_STATES' }));
        }
      };
      
      // Tentativi multipli all'avvio per essere sicuri che il bridge sia pronto
      setTimeout(sendHandshake, 500);
      setTimeout(sendHandshake, 2000);
      setTimeout(sendHandshake, 5000);
    }
  }, []);

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/webhook`);
    
    // Subscribe to push notifications if permitted
    if (notifPermission === "granted") {
      subscribeUser();
    }
  }, [notifPermission]);

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  const subscribeUser = async (retries = 3) => {
    if ('serviceWorker' in navigator) {
      try {
        console.log(`App: Tentativo sottoscrizione push (${4-retries}/3)...`);
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        
        // Recupera la chiave pubblica corrente dal server
        const response = await fetch('/api/vapid-public-key');
        if (!response.ok) throw new Error(`VAPID key fetch failed with status ${response.status}`);
        const { publicKey } = await response.json();
        const serverKey = urlBase64ToUint8Array(publicKey);

        // Se esiste una sottoscrizione, controlliamo se la chiave coincide
        if (subscription) {
          try {
            await subscription.unsubscribe();
            console.log("App: Vecchia sottoscrizione rimossa per sincronizzazione chiavi");
          } catch (e) {
            console.warn("App: Errore durante l'unsubscription, procedo comunque...");
          }
        }
        
        // Tenta la nuova sottoscrizione
        try {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: serverKey
          });
        } catch (subErr) {
          console.error("App: Errore durante subscribe, riprovo reset:", subErr);
          const sub = await registration.pushManager.getSubscription();
          if (sub) await sub.unsubscribe();
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: serverKey
          });
        }
        
        const saveResponse = await fetch('/api/subscribe', {
          method: 'POST',
          body: JSON.stringify(subscription),
          headers: { 'Content-Type': 'application/json' }
        });

        if (!saveResponse.ok) throw new Error("Failed to save subscription on server");
        
        console.log("App: Sottoscrizione Push completata con successo");
      } catch (err: any) {
        if (err.message === "Failed to fetch") {
          console.error("App: Errore di connessione al server (API offline?)");
        } else {
          console.error("App: Errore sottoscrizione push:", err);
        }
        if (retries > 0) {
          console.log("App: Riprovo tra 5 secondi...");
          setTimeout(() => subscribeUser(retries - 1), 5000);
        }
      }
    }
  };

  const speakLocally = (text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (isInApp && (window as any).ReactNativeWebView) {
        addLog("SND: SPEAK");
        console.log("Native: Richiedo riproduzione vocale via bridge (" + text + ")");
        (window as any).ReactNativeWebView.postMessage(JSON.stringify({ 
          type: 'SPEAK', 
          text: text,
          lang: voiceLang,
          volume: volume / 100
        }));
        // Per ora risolviamo subito, in futuro potremmo attendere evento 'SPEAK_DONE'
        setTimeout(resolve, 2000);
        return;
      }

      if (!('speechSynthesis' in window)) {
        console.warn("SpeechSynthesis non supportato dal browser");
        resolve();
        return;
      }

      // Su mobile a volte si blocca, resettiamo prima
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = voiceLang;
      utterance.volume = volume / 100;
      utterance.rate = 1.0;
      
      let isResolved = false;
      const done = () => {
        if (isResolved) return;
        isResolved = true;
        resolve();
      };

      utterance.onend = () => {
        console.log("Lettura locale terminata");
        done();
      };
      utterance.onerror = (e) => {
        console.error("SpeechSynthesis error:", e);
        done();
      };
      
      window.speechSynthesis.speak(utterance);

      // Safety timeout for speech synthesis
      setTimeout(() => {
        if (!isResolved) {
          console.warn("SpeechSynthesis safety timeout triggered");
          done();
        }
      }, 10000);
    });
  };

  const readOutLoud = useCallback((notif: Notification): Promise<void> => {
    const textToRead = `Notifica da ${notif.app}. ${notif.title ? notif.title + ' dice: ' : ''} ${notif.message}`;
    const isInApp = typeof navigator !== 'undefined' && (navigator.userAgent.includes('VoxHomeBridgeExpo') || (window as any).ReactNativeWebView);

    // Se siamo nell'app mobile, deleghiamo SEMPRE alla parte nativa
    // La parte nativa sa se deve riprodurre via TTS locale o via Cast
    if (isInApp && (window as any).ReactNativeWebView) {
      console.log("Native: Richiedo lettura via bridge per:", notif.app);
      return speakLocally(textToRead);
    }

    if (!castSessionRef.current || !isCastingRef.current) {
      console.log("Lettura locale avviata per:", notif.app);
      return speakLocally(textToRead);
    }

    return new Promise((resolve) => {
      const encodedText = encodeURIComponent(textToRead);
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${voiceLang}&client=tw-ob&q=${encodedText}`;

      const mediaInfo = new (window as any).chrome.cast.media.MediaInfo(ttsUrl, "audio/mp3");
      const request = new (window as any).chrome.cast.media.LoadRequest(mediaInfo);
      
      try {
        const session = castSessionRef.current;
        if (!session || session.getSessionState() !== (window as any).cast.framework.SessionState.SESSION_STARTED) {
          console.warn("Cast: Sessione non più attiva, uso lettura locale.");
          speakLocally(textToRead).then(resolve);
          return;
        }

        session.setVolume(volume / 100).catch(() => {});

        session.loadMedia(request).then(
          (mediaSession: any) => {
            if (!mediaSession) {
              console.warn("Cast: MediaSession non disponibile");
              setTimeout(resolve, 2000);
              return;
            }
            // ... wait for finish ...

            let hasStartedPlaying = false;
            let isFinished = false;

            const checkStatus = () => {
              if (isFinished) return;
              try {
                const state = mediaSession.playerState;
                console.log(`[Cast State] ${notif.app}: ${state}`);
                
                if (state === "PLAYING" || state === "BUFFERING") {
                  hasStartedPlaying = true;
                }

                // Risolviamo solo se è passato per uno stato attivo ed è tornato in IDLE
                if (hasStartedPlaying && state === "IDLE") {
                  isFinished = true;
                  try { mediaSession.removeUpdateListener(checkStatus); } catch(e) {}
                  console.log(`Lettura conclusa per: ${notif.app}`);
                  setTimeout(resolve, 1200); // Intervallo tra notifiche
                }
              } catch (err) {
                console.error("Errore listener Cast:", err);
                if (!isFinished) {
                  isFinished = true;
                  resolve();
                }
              }
            };
            
            try {
              mediaSession.addUpdateListener(checkStatus);
              // Check immediato dopo piccola pausa per permettere al server Cast di aggiornare lo stato
              setTimeout(checkStatus, 300);
            } catch (err) {
              console.error("Errore configurazione listener:", err);
              if (!isFinished) {
                isFinished = true;
                resolve();
              }
            }

            // Timeout di sicurezza estremo
            setTimeout(() => {
              if (!isFinished) {
                console.warn(`Timeout sicurezza raggiunto per: ${notif.app}`);
                isFinished = true;
                try { mediaSession.removeUpdateListener(checkStatus); } catch(e){}
                resolve();
              }
            }, 25000);
          },
          (e: any) => {
            console.error("Errore caricamento media", e);
            resolve();
          }
        ).catch((err: any) => {
          console.error("Unhandled error in loadMedia success handler", err);
          resolve();
        });
      } catch (err) {
        console.error("Critical error in readOutLoud", err);
        resolve();
      }
    });
  }, [voiceLang, volume]); // Removed isCasting to use Ref inside

  const readingPromiseRef = useRef<Promise<void>>(Promise.resolve());

  const queueReading = useCallback((notif: Notification, force: boolean = false) => {
    console.log(`Coda: Aggiunta notifica da ${notif.app} alla lista d'attesa`);
    
    // Concatenazione atomica sulla coda di lettura
    readingPromiseRef.current = readingPromiseRef.current.catch(err => {
      console.warn("Coda: Recupero da errore precedente:", err);
    }).then(async () => {
      // Verifica i permessi NEL MOMENTO della riproduzione
      if (!isReadingActiveRef.current && !force) {
        console.log(`Coda: Lettura ignorata per ${notif.app} (Voce DISATTIVATA al momento del turno)`);
        return;
      }

      console.log(`Coda: È il turno di ${notif.app}, avvio riproduzione...`);
      try {
        await readOutLoud(notif);
        if (!force) {
          setUnreadCount(prev => Math.max(0, prev - 1));
        }
      } catch (error) {
        console.error("Coda: Errore durante la lettura di", notif.app, error);
      }
    });
    return readingPromiseRef.current;
  }, [readOutLoud]);

  const stopVoiceWindow = useCallback(() => {
    console.log("Stopping voice window...");
    isMicWindowActiveRef.current = false;
    setIsMicWindowActive(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    if (listeningTimerRef.current) {
      clearTimeout(listeningTimerRef.current);
      listeningTimerRef.current = null;
    }
  }, []);

  const startListeningWindow = useCallback(() => {
    if (!checkWiFiAccess()) {
      console.warn("WiFi: Accesso microfono negato (Fuori casa)");
      return;
    }

    console.log("Starting 10s voice window...");
    
    // Reset any existing timer
    if (listeningTimerRef.current) {
      clearTimeout(listeningTimerRef.current);
    }
    
    isMicWindowActiveRef.current = true;
    setIsMicWindowActive(true);
    
    try {
      if (recognitionRef.current) {
        recognitionRef.current.start();
      }
    } catch (e) {
      // Already started
    }

    // Set 10s window
    listeningTimerRef.current = setTimeout(() => {
      stopVoiceWindow();
    }, 10000);
  }, [stopVoiceWindow]);

  const processedNotifsRef = useRef<Set<string>>(new Set());

  const processNotification = useCallback((notif: Notification, force: boolean = false) => {
    // Deduplicazione robusta basata su contenuto e finestra temporale
    const notifKey = `${notif.app}:${notif.message}:${Math.floor(notif.timestamp / 3000)}`;
    if (processedNotifsRef.current.has(notifKey)) {
      console.log("App: Notifica già processata (duplicato), salto.");
      return Promise.resolve();
    }
    processedNotifsRef.current.add(notifKey);
    // Pulizia periodica del set
    if (processedNotifsRef.current.size > 100) processedNotifsRef.current.clear();

    const appNameLC = notif.app.toLowerCase();
    const currentAllowed = allowedAppsRef.current;
    let config = currentAllowed.find(a => a.name.toLowerCase() === appNameLC);
    
    // Auto-add unknown apps (enabled by default)
    if (!config) {
      console.log(`App: Nuova notifica IFTTT/Altro rilevata: ${notif.app}`);
      const newConfig = { name: notif.app, enabled: true };
      setAllowedApps(prev => {
        if (prev.find(a => a.name.toLowerCase() === appNameLC)) return prev;
        const newList = [...prev, newConfig];
        localStorage.setItem("voiceNotifier_apps", JSON.stringify(newList));
        return newList;
      });
      console.log("App: Aggiunta automatica app eseguita, invio a coda...");
      config = newConfig;
    }

    // Se l'app non è abilitata nelle impostazioni, non registrarla nemmeno nello storico (come chiesto dall'utente)
    if (!config.enabled) {
      console.warn(`App: Notifica ignorata per ${notif.app} (App DISABILITATA in lista)`);
      return Promise.resolve();
    }

    // Aggiungi allo storico solo se abilitata
    setNotifications(prev => {
      const exists = prev.some(n => 
        n.message === notif.message && 
        n.app === notif.app &&
        Math.abs(n.timestamp - notif.timestamp) < 5000
      );
      if (exists) return prev;
      return [notif, ...prev].slice(0, 50);
    });

    if (isReadingActiveRef.current || force) {
      console.log(`App: Invio a coda lettura per ${notif.app} (Abilitata)`);
      return queueReading(notif, force);
    } else {
      console.log(`App: Incremento contatore non letti per ${notif.app} (Voce DISATTIVATA)`);
      setUnreadCount(prev => prev + 1);
      
      // Start listening window for 10s to allow user to say "Leggi"
      startListeningWindow();
    }
    return Promise.resolve();
  }, [queueReading, startListeningWindow]);

  const sendTestNotification = async () => {
    const testPayload = {
      app: "IFTTT",
      title: "Test Inviato",
      message: "Questo è un test per verificare la lettura automatica.",
      timestamp: Date.now()
    };

    // 1. Local Browser Feedback
    if (typeof Notification !== "undefined") {
      if (Notification.permission === "granted") {
        try {
          const reg = await navigator.serviceWorker.ready;
          await reg.showNotification(testPayload.title, { body: testPayload.message });
        } catch(e) {
          try { new Notification(testPayload.title, { body: testPayload.message }); } catch(err){}
        }
      } else if (Notification.permission === "default") {
        const perm = await Notification.requestPermission();
        setNotifPermission(perm);
      }
    }

    // 2. Local State update (immediate visibility)
    setNotifications(prev => {
      const exists = prev.some(n => n.message === testPayload.message && Math.abs(n.timestamp - testPayload.timestamp) < 5000);
      if (exists) return prev;
      return [testPayload, ...prev].slice(0, 50);
    });
    setUnreadCount(prev => prev + 1);
    processNotification(testPayload).catch(err => console.error("Test notification error:", err));

    // 3. Real Push via Server
    try {
      const response = await fetch("/api/test-push", { method: "POST" });
      if (!response.ok) throw new Error("Push test failed");
      console.log("Notifica di test inviata via Push REALE dal server");
    } catch (error) {
      console.error("Invio push reale fallito:", error);
    }
  };

  const readRecentNotifications = useCallback(async (count: number) => {
    const available = notificationsRef.current;
    if (available.length === 0) {
      console.log("Nessuna notifica presente nel buffer.");
      return;
    }

    const actualCount = Math.min(count, available.length);
    // Take the 'actualCount' most recent and reverse to read from oldest to newest
    const toRead = [...available].slice(0, actualCount).reverse();
    
    console.log(`Comando ricevuto: Lettura di ${actualCount} notifiche (su ${available.length} disponibili)`);
    
    for (const n of toRead) {
      await processNotification(n, true);
    }
    
    setUnreadCount(prev => Math.max(0, prev - actualCount));
  }, [processNotification]);

  const readRecentNotificationsRef = useRef(readRecentNotifications);
  useEffect(() => {
    readRecentNotificationsRef.current = readRecentNotifications;
  }, [readRecentNotifications]);

  // Voice Recognition setup
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'it-IT';

      rec.onresult = (event: any) => {
        try {
          const result = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
          console.log("Voice Command Recognized:", result);
          
          let actionTriggered = false;

          // Command "LEGGI NOTIFICHE"
          if (result.includes("leggi notifiche") && !result.includes("ultime") && !result.includes("ultima")) {
            setIsReadingActive(true);
            actionTriggered = true;
          } 
          // Command "FERMA LETTURA"
          else if (result.includes("ferma lettura") || result.includes("ferma lettura notifiche")) {
            setIsReadingActive(false);
            actionTriggered = true;
          }

          // --- DEVICE AND DATA COMMANDS ---
          let targetDevice: string | null = null;
          let countToRead = 0;
          let shouldConnect = false;

          if (result.includes("connetti a")) {
            targetDevice = result.split("connetti a")[1]?.trim();
            shouldConnect = true;
            actionTriggered = true;
          } else if (result.includes(" su ")) {
            const parts = result.split(" su ");
            if (parts.length >= 2) {
              const actionPart = parts[0];
              targetDevice = parts[parts.length - 1]?.trim();
              shouldConnect = true;
              actionTriggered = true;

              if (actionPart.includes("leggi l'ultima") || actionPart.includes("leggi l'ultima notifica")) {
                countToRead = 1;
              } else if (actionPart.includes("leggi le ultime")) {
                 const italianNumbers: {[key: string]: number} = {
                  "una": 1, "uno": 1, "due": 2, "tre": 3, "quattro": 4, "cinque": 5, 
                  "sei": 6, "sette": 7, "otto": 8, "nove": 9, "dieci": 10
                };
                const words = actionPart.split(/\s+/).map(w => w.replace(/[,.?!]/g, ''));
                const uIndex = words.indexOf("ultime");
                if (uIndex !== -1 && words[uIndex + 1]) {
                  const nextWord = words[uIndex + 1];
                  countToRead = !isNaN(parseInt(nextWord)) ? parseInt(nextWord) : (italianNumbers[nextWord] || 3);
                } else {
                  countToRead = 3;
                }
              }
            }
          }

          if (shouldConnect) {
            if (countToRead > 0) pendingActionRef.current = { type: "read", count: countToRead };
            if (!isCastingRef.current) handleCast();
            else if (countToRead > 0) readRecentNotificationsRef.current(countToRead).catch(console.error);
            return;
          }
          
          // --- GENERIC HISTORY COMMANDS ---
          if (result.includes("leggi l'ultima") || result.includes("leggi la notifica")) {
            readRecentNotificationsRef.current(1).catch(console.error);
            actionTriggered = true;
          }
          else if (result.includes("leggi le ultime")) {
            const italianNumbers: {[key: string]: number} = {
              "una": 1, "uno": 1, "due": 2, "tre": 3, "quattro": 4, "cinque": 5, 
              "sei": 6, "sette": 7, "otto": 8, "nove": 9, "dieci": 10
            };
            
            let countSelected = 0;
            const words = result.split(/\s+/).map(w => w.replace(/[,.?!]/g, ''));
            const index = words.indexOf("ultime");
            
            if (index !== -1 && words[index + 1]) {
              const nextWord = words[index + 1];
              if (!isNaN(parseInt(nextWord))) countSelected = parseInt(nextWord);
              else if (italianNumbers[nextWord]) countSelected = italianNumbers[nextWord];
            }
            
            if (countSelected > 0) {
              readRecentNotificationsRef.current(countSelected).catch(console.error);
              actionTriggered = true;
            } else if (result.includes("leggi le ultime notifiche")) {
              readRecentNotificationsRef.current(3).catch(console.error);
              actionTriggered = true;
            }
          }

          // If a command was successfully executed, we might want to shut the mic soon
          if (actionTriggered) {
             // Let it stay open for 2 more seconds in case they want another command?
             // Or stop immediately? Let's give it a tiny bit of room.
          }

        } catch (err) {
          console.error("Critical error in voice command handler:", err);
        }
      };

      rec.onstart = () => setIsListening(true);
      rec.onend = () => {
        setIsListening(false);
        // Only auto-restart if we are in the 10s Window
        if (isMicWindowActiveRef.current) {
          setTimeout(() => {
            try {
              if (recognitionRef.current) recognitionRef.current.start();
            } catch (e) {}
          }, 300);
        }
      };
      recognitionRef.current = rec;
    }
  }, []); // Only setup once

  const toggleListening = () => {
    if (isInApp && (window as any).ReactNativeWebView) {
      addLog("SND: START_LISTENING");
      // Segnala all'app che stiamo provando ad usare il microfono
      (window as any).ReactNativeWebView.postMessage(JSON.stringify({ type: 'START_LISTENING' }));
    }

    if (isListening) {
      stopVoiceWindow();
    } else {
      startListeningWindow();
    }
  };

  const toggleReading = () => {
    const newActiveState = !isReadingActive;
    
    if (newActiveState) {
      if (!checkWiFiAccess()) {
        alert("Attivazione negata: Devi essere connesso al WiFi di casa per attivare la lettura automatica.");
        return;
      }
      // Prime voice engine to allow background speech
      speakLocally("Lettura attivata");
    }
    
    setIsReadingActive(newActiveState);
  };

  // Socket connection
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on("notification", (data: Notification) => {
      console.log("Ricevuta nuova notifica via socket:", data);
      processNotification(data).catch(err => console.error("Notification process error:", err));
    });

    newSocket.on("buffer_sync", (buffer: Notification[]) => {
      setNotifications(prev => {
        const combined = [...buffer, ...prev];
        // Unique by id or timestamp/message
        const unique = Array.from(new Map(combined.map(item => [item.timestamp + item.message, item])).values());
        return unique.sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
      });
      setUnreadCount(buffer.length);
    });

    newSocket.on("discovered_apps", (apps: string[]) => {
      setAvailableApps(prev => Array.from(new Set([...prev, ...apps])));
    });

    return () => {
      newSocket.close();
    };
  }, [processNotification]);

  // Handle SW and BroadcastChannel notifications
  useEffect(() => {
    const handleNotificationData = (pushData: any) => {
      // Evita duplicati immediati tra BroadcastChannel e PostMessage
      const now = Date.now();
      const lastProcessed = (window as any)._lastProcessedNotif;
      if (lastProcessed && 
          lastProcessed.message === pushData.message && 
          Math.abs(now - lastProcessed.time) < 1000) {
        return;
      }
      (window as any)._lastProcessedNotif = { message: pushData.message, time: now };

      const notification: Notification = {
        app: pushData.appName || pushData.app || 'Push',
        title: pushData.title || '',
        message: pushData.message || '',
        timestamp: pushData.timestamp || Date.now()
      };
      
      console.log("App: Ricevuta notifica (SW/BC):", notification);
      processNotification(notification).catch(err => console.error("Push process error:", err));
    };

    // 1. PostMessage/Native Bridge Listener
    const handleMessage = (event: any) => {
      let data;
      
      // Handle different ways data arrives in various WebViews
      const rawData = event.data || (event.nativeEvent && event.nativeEvent.data);
      
      if (typeof rawData === 'string') {
        try {
          data = JSON.parse(rawData);
        } catch (e) {
          // If it's a string but not JSON, it might be a direct command
          addLog("STR: " + rawData.substring(0, 50));
          return;
        }
      } else {
        data = rawData;
      }

      if (!data || !data.type) return;

      addLog(`RCV: ${data.type}`);
      console.log("App: Ricevuto messaggio via Bridge:", data.type, data);

      if (data.type === 'PUSH_NOTIFICATION') {
        handleNotificationData(data.data);
      } else if (data.type === 'NOTIF_PERMISSION_RESULT') {
        setNotifPermission(data.permission);
      } else if (data.type === 'READING_STATE_CHANGED') {
        console.log("Native: Reading state changed:", data.enabled);
        setIsReadingActive(!!data.enabled);
      } else if (data.type === 'CAST_STATE_CHANGED') {
        console.log("Cast: Stato cambiato da app nativa:", data);
        setIsCasting(!!data.isCasting);
        setDeviceName(data.deviceName || null);
      } else if (data.type === 'STATE_UPDATE') {
        // Risposta a GET_STATES
        console.log("App: Ricevuto aggiornamento stati completi:", data);
        if (data.isCasting !== undefined) setIsCasting(!!data.isCasting);
        if (data.deviceName !== undefined) setDeviceName(data.deviceName);
        if (data.isReadingActive !== undefined) setIsReadingActive(!!data.isReadingActive);
      } else if (data.type === 'LISTENING_STARTED' || data.type === 'MIC_PERMISSION_GRANTED') {
        // Se l'app ci dà l'ok, proviamo ad avviare la finestra vocale se non era già attiva
        if (!isMicWindowActiveRef.current) {
          startListeningWindow();
        }
      }
    };

    // 2. Register Listeners (Web, Document and SW)
    window.addEventListener('message', handleMessage);
    (window as any).onMessage = handleMessage; // Alias per certi bridge
    document.addEventListener('message', handleMessage as any); // Importante per certi WebView
    
    const bc = new BroadcastChannel('voxhome_notifications');
    bc.onmessage = (event) => {
      if (event.data && event.data.type === 'PUSH_NOTIFICATION') {
        handleNotificationData(event.data.data);
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleMessage);
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      document.removeEventListener('message', handleMessage as any);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      }
      bc.close();
    };
  }, [processNotification, startListeningWindow]);

  const readHistory = () => {
    readRecentNotifications(unreadCount || 5).catch(err => console.error("History playback failed:", err));
  };

  // Google Cast Initialization
  useEffect(() => {
    const initializeCast = () => {
      if (typeof window !== "undefined" && (window as any).cast && (window as any).cast.framework) {
        const castContext = (window as any).cast.framework.CastContext.getInstance();
        castContext.setOptions({
          receiverApplicationId: (window as any).chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: (window as any).chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
        });

        castContext.addEventListener(
          (window as any).cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
          (event: any) => {
            // Se siamo nell'app nativa, ignoriamo gli stati del SDK browser per evitare conflitti
            if (isInAppRef.current) return;

            switch (event.sessionState) {
              case (window as any).cast.framework.SessionState.SESSION_STARTED:
              case (window as any).cast.framework.SessionState.SESSION_RESUMED:
                castSessionRef.current = castContext.getCurrentSession();
                setIsCasting(true);
                setDeviceName(castSessionRef.current.getCastDevice().friendlyName);
                
                // Execute pending action if any
                if (pendingActionRef.current) {
                  const action = pendingActionRef.current;
                  pendingActionRef.current = null;
                  if (action.type === "read") {
                    setTimeout(() => {
                      readRecentNotificationsRef.current(action.count).catch(err => {
                        console.error("Deferred reading failed", err);
                      });
                    }, 1500); // Wait for session to be fully ready
                  }
                }
                break;
              case (window as any).cast.framework.SessionState.SESSION_ENDED:
                setIsCasting(false);
                setDeviceName(null);
                castSessionRef.current = null;
                break;
            }
          }
        );
        return true;
      }
      return false;
    };

    // Global callback for Cast SDK
    (window as any).__onGCastApiAvailable = (isAvailable: boolean) => {
      if (isAvailable) {
        initializeCast();
      }
    };

    // Fallback/check if already available
    const interval = setInterval(() => {
      if (initializeCast()) {
        clearInterval(interval);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      (window as any).__onGCastApiAvailable = null;
    };
  }, []);

  const handleCast = () => {
    // Se siamo nell'app mobile, usiamo il bridge nativo
    if (isInApp) {
      if ((window as any).ReactNativeWebView) {
        addLog("SND: SHOW_CAST_PICKER");
        console.log("Cast: Richiedo picker nativo via WebView");
        (window as any).ReactNativeWebView.postMessage(JSON.stringify({ type: 'SHOW_CAST_PICKER' }));
        return;
      }
    }

    if (typeof window !== "undefined" && (window as any).cast && (window as any).cast.framework) {
      const castContext = (window as any).cast.framework.CastContext.getInstance();
      try {
        if (isCasting) {
          console.log("Cast: Chiudo sessione attiva");
          castContext.endCurrentSession(true);
        } else {
          console.log("Cast: Richiedo nuova sessione");
          castContext.requestSession().catch((err: any) => {
            if (err !== 'cancel') {
              console.error("Cast session request failed", err);
            } else {
              console.log("Cast session request cancelled by user");
            }
          });
        }
      } catch (err) {
        console.error("Cast operation crash", err);
      }
    } else {
      console.warn("Cast: Framework non caricato o non disponibile");
    }
  };

  const addApp = (appName: string) => {
    const formattedName = appName.trim();
    if (formattedName && !allowedApps.find(a => a.name.toLowerCase() === formattedName.toLowerCase())) {
      setAllowedApps([...allowedApps, { name: formattedName, enabled: true }]);
      setNewAppInput("");
      setShowAppModal(false);
      setSearchTerm("");
    }
  };

  const toggleApp = (name: string) => {
    setAllowedApps(prev => prev.map(a => a.name === name ? { ...a, enabled: !a.enabled } : a));
  };

  const removeApp = (name: string) => {
    setAllowedApps(prev => prev.filter(a => a.name !== name));
  };

  const testVoice = () => {
    const testNotif: Notification = {
      app: "Test",
      title: "Sistema",
      message: "Questa è una prova della voce configurata.",
      timestamp: Date.now()
    };
    if (isCasting) {
      queueReading(testNotif, true).catch(err => console.error("Voice test queue error:", err));
    } else {
      speakLocally(testNotif.message).catch(err => console.error("Voice test speak error:", err));
    }
  };
  return (
    <div className="flex flex-col h-screen w-full bg-[#020617] text-slate-200 overflow-hidden font-sans">
      {/* Main Content */}
      <main className="flex-1 flex flex-col p-4 md:p-8 overflow-y-auto custom-scrollbar pb-24">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-2 pb-6 mb-4 border-b border-slate-800">
          <div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-1">
              VoxHome <span className="text-cyan-400">{activeTab === "home" ? "Bridge" : "Settings"}</span>
            </h1>
            <p className="text-slate-400 text-xs md:text-sm flex items-center gap-2">
              <Activity size={14} className="text-cyan-500" />
              {activeTab === "home" ? "Notifiche telefono su Google Home" : "Configura le tue preferenze"}
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <button 
              onClick={toggleReading}
              className={`flex items-center gap-2 px-4 py-1.5 md:px-6 md:py-2 glass-card rounded-full border-2 transition-all active:scale-95 ${isReadingActive ? "border-cyan-500/50 glow-cyan-strong cursor-pointer hover:bg-cyan-500/10" : "border-slate-800 cursor-pointer hover:bg-slate-800/50"}`}
            >
              <div className={`w-2 h-2 rounded-full ${isReadingActive ? "bg-cyan-400 shadow-[0_0_8px_#22d3ee]" : "bg-slate-600"}`}></div>
              <span className={`text-[10px] md:text-xs font-bold tracking-wider uppercase ${isReadingActive ? "text-cyan-400" : "text-slate-500"}`}>
                {isReadingActive ? "Ferma Lettura" : "Leggi Notifiche"}
              </span>
            </button>
            
            <button 
              onClick={handleCast}
              className={`flex items-center gap-2 px-4 py-1.5 md:px-6 md:py-2 glass-card rounded-full border-2 transition-all active:scale-95 ${isCasting ? "border-cyan-500/50 glow-cyan-strong cursor-pointer hover:bg-cyan-500/10" : "border-slate-800 cursor-pointer hover:bg-slate-800/50"}`}
            >
              <div className={`w-2 h-2 rounded-full ${isCasting ? "bg-cyan-400 shadow-[0_0_8px_#22d3ee]" : "bg-slate-600"}`}></div>
              <span className={`text-[10px] md:text-xs font-bold tracking-wider uppercase ${isCasting ? "text-cyan-400" : "text-slate-500"}`}>
                {isCasting ? `Disconnetti ${deviceName}` : "Cerca Dispositivo"}
              </span>
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
          <AnimatePresence mode="wait">
            {activeTab === "home" ? (
              <motion.div 
                key="home-view"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="lg:col-span-12 space-y-6"
              >
                {/* Buffer reader quick action */}
                <div className="p-6 glass-card rounded-3xl border-orange-500/20 glow-indigo flex flex-col sm:flex-row items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-orange-500/20 p-4 rounded-2xl text-orange-400 shadow-lg shadow-orange-500/10">
                      <Activity size={32} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">Notifiche in Coda</h3>
                      <p className="text-sm text-slate-400">Ci sono {unreadCount} notifiche non ancora riprodotte.</p>
                    </div>
                  </div>
                  <button 
                    onClick={readHistory}
                    disabled={unreadCount === 0}
                    className="w-full sm:w-auto px-8 py-4 bg-orange-500 text-slate-950 rounded-2xl font-bold hover:bg-orange-400 transition-all disabled:opacity-20 shadow-xl shadow-orange-500/20 active:scale-95 flex items-center justify-center gap-3"
                  >
                    <Play size={20} fill="currentColor" /> Leggi Ora
                  </button>
                </div>

                {/* Notifications Feed */}
                <section className="glass-card rounded-3xl p-4 md:p-6 glow-indigo">
                  <div className="flex items-center justify-between mb-4 md:mb-6">
                    <h3 className="text-lg md:text-xl font-bold flex items-center gap-2">
                      <Activity size={20} className="text-slate-400" />
                      Storico Notifiche
                    </h3>
                  </div>
                  <div className="space-y-2 h-[450px] overflow-y-auto pr-1 custom-scrollbar">
                    <AnimatePresence initial={false}>
                      {notifications.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-600 py-10 opacity-40">
                          <Bell size={48} strokeWidth={1} className="mb-4" />
                          <p className="text-sm font-medium">In attesa di nuovi messaggi...</p>
                        </div>
                      ) : (
                        notifications.map((notif, i) => (
                          <motion.div 
                            key={notif.timestamp + i}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="p-4 rounded-2xl bg-slate-800/30 border border-slate-700/30 flex items-center gap-4 md:gap-6"
                          >
                            <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-500 shrink-0 uppercase">
                              {notif.app.substring(0, 3)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-bold text-white truncate">{notif.title}</span>
                                <span className="text-[10px] font-medium text-slate-500 shrink-0">{new Date(notif.timestamp).toLocaleTimeString()}</span>
                              </div>
                              <p className="text-sm text-slate-400 line-clamp-2 leading-relaxed">{notif.message}</p>
                            </div>
                            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] shrink-0"></div>
                          </motion.div>
                        ))
                      )}
                    </AnimatePresence>
                  </div>
                </section>
              </motion.div>
            ) : (
              <motion.div 
                key="settings-view"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="lg:col-span-12 space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Debug Native Bridge */}
                  {isInApp && (
                    <section className="glass-card rounded-3xl p-6 glow-red col-span-1 md:col-span-2">
                       <h3 className="text-lg md:text-xl font-bold mb-4 flex items-center gap-2 text-white">
                        <Activity size={20} className="text-red-400" />
                        Android Native Bridge Debug
                      </h3>
                      <div className="bg-slate-900/80 rounded-2xl p-4 h-48 overflow-y-auto font-mono text-[10px] space-y-1">
                        {bridgeLogs.length === 0 ? (
                          <div className="text-slate-700">In attesa di traffico bridge...</div>
                        ) : (
                          bridgeLogs.map((log, i) => (
                            <div key={i} className="flex gap-2">
                              <span className="text-slate-600">[{new Date().toLocaleTimeString()}]</span>
                              <span className="text-cyan-500 font-bold">{log}</span>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button 
                          onClick={() => {
                            if ((window as any).ReactNativeWebView) {
                              (window as any).ReactNativeWebView.postMessage(JSON.stringify({ type: 'GET_STATES' }));
                              addLog("SND: GET_STATES");
                            }
                          }}
                          className="px-4 py-2 bg-slate-800 rounded-xl text-[10px] font-bold uppercase hover:bg-slate-700"
                        >
                          Sync Stati
                        </button>
                        <button 
                          onClick={() => setBridgeLogs([])}
                          className="px-4 py-2 bg-slate-800 rounded-xl text-[10px] font-bold uppercase hover:bg-slate-700"
                        >
                          Pulisci Log
                        </button>
                      </div>
                    </section>
                  )}

                  {/* App Triggers */}
                  <section className="glass-card rounded-3xl p-6 glow-cyan">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 md:mb-6 gap-3">
                      <h3 className="text-lg md:text-xl font-bold flex items-center gap-2 text-white">
                        <Smartphone size={20} className="text-cyan-400" /> 
                        Monitor App
                      </h3>
                      <button 
                        onClick={() => setShowAppModal(true)}
                        className="bg-cyan-500 text-slate-950 px-4 py-2 rounded-xl hover:bg-cyan-400 transition-all flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider"
                      >
                        <Plus size={14} /> Aggiungi App
                      </button>
                    </div>
                    <div className="space-y-2 h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                      <AnimatePresence initial={false}>
                        {allowedApps.map(app => (
                          <motion.div 
                            key={app.name}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center justify-between p-3 rounded-2xl bg-slate-800/40 border border-slate-700/50 group"
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-sm ${app.enabled ? "bg-cyan-500/20 text-cyan-400" : "bg-slate-700/20 text-slate-500"}`}>
                                {app.name.charAt(0)}
                              </div>
                              <p className={`font-semibold text-sm ${app.enabled ? "text-white" : "text-slate-500 line-through"}`}>{app.name}</p>
                            </div>
                            <div className="flex items-center gap-4">
                              <button 
                                onClick={() => toggleApp(app.name)}
                                className={`w-10 h-5 rounded-full relative transition-all duration-300 ${app.enabled ? "bg-cyan-500/20 border-cyan-500/50" : "bg-slate-700 border-slate-600"} border`}
                              >
                                <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 ${app.enabled ? "right-0.5 bg-cyan-400" : "left-0.5 bg-slate-400"}`}></div>
                              </button>
                              <button onClick={() => removeApp(app.name)} className="text-slate-600 hover:text-red-400 p-1"><Trash2 size={14} /></button>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </section>

                  {/* Status Bridge Info */}
                  <section className="glass-card rounded-3xl p-6 glow-indigo flex flex-col">
                    <h3 className="text-lg md:text-xl font-bold mb-4 md:mb-6 flex items-center gap-2 text-white">
                      <Volume2 size={20} className="text-indigo-400" />
                      Status Bridge
                    </h3>
                    <div className="space-y-6">
                      <div className="p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50 flex flex-col gap-2">
                        <div className="flex items-center justify-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${isReadingActive ? "bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]" : "bg-slate-600"}`}></div>
                          <span className="text-sm font-bold text-white uppercase tracking-wider">
                            {isReadingActive ? "Voce Attiva" : "Voce Disattivata"}
                          </span>
                        </div>
                        <p className="text-[10px] font-medium text-slate-500 text-center mt-1 uppercase tracking-widest">
                          {isReadingActive ? "Il sistema leggerà le notifiche in arrivo" : "Il sistema rimarrà in ascolto senza parlare"}
                        </p>
                      </div>

                      <div className="p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50 flex flex-col gap-2 relative overflow-hidden">
                        <div className="flex items-center justify-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${notifPermission === "granted" ? "bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]" : "bg-slate-600"}`}></div>
                          <span className="text-sm font-bold text-white uppercase tracking-wider">
                            Push: {notifPermission === "granted" ? "Abilitato" : notifPermission === "denied" ? "Bloccato" : "Non autoriz."}
                          </span>
                        </div>
                        {notifPermission !== "granted" && (
                          <button 
                            onClick={requestNotifPermission}
                            className="mt-2 text-[10px] bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 font-bold py-1 px-2 rounded-lg border border-cyan-500/20 transition-all uppercase tracking-widest"
                          >
                            Richiedi Permesso
                          </button>
                        )}
                        <p className="text-[10px] font-medium text-slate-500 text-center mt-1 uppercase tracking-widest leading-tight">
                          Necessario per testare le notifiche Push su questo dispositivo
                        </p>
                      </div>

                      <div className="p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50 flex flex-col gap-2 relative overflow-hidden">
                        {isMicWindowActive && (
                          <div className="absolute inset-0 bg-cyan-500/5 glow-cyan animate-pulse pointer-events-none"></div>
                        )}
                        <div className="flex items-center justify-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${isMicWindowActive ? "bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]" : "bg-slate-600"}`}></div>
                          <span className="text-sm font-bold text-white uppercase tracking-wider">
                            {isMicWindowActive ? "Ascolto Attivo" : "Microfono Spento"}
                          </span>
                        </div>
                        <p className={`text-[10px] font-bold text-center mt-1 uppercase tracking-widest ${isMicWindowActive ? "text-cyan-400" : "text-slate-500"}`}>
                          {isMicWindowActive ? "Parla ora..." : "Si attiva alla notifica"}
                        </p>
                      </div>

                      <div className="p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50 flex flex-col gap-2 relative overflow-hidden">
                        <div className="flex items-center justify-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${isCasting ? "bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.5)]" : "bg-slate-600"}`}></div>
                          <span className="text-sm font-bold text-white uppercase tracking-wider">
                            {isCasting ? "Cast Connesso" : "Cast Disconnesso"}
                          </span>
                        </div>
                        {deviceName && (
                          <p className="text-[10px] font-medium text-cyan-400 text-center uppercase tracking-widest">
                            {deviceName}
                          </p>
                        )}
                      </div>
                    </div>
                  </section>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Schedulazione */}
                  <section className="glass-card rounded-3xl p-6 glow-purple">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-lg md:text-xl font-bold flex items-center gap-2 text-white">
                        <Clock size={20} className="text-purple-400" />
                        Programmazione
                      </h3>
                      <button 
                        onClick={addSchedule}
                        className="bg-purple-500/10 text-purple-400 p-2 rounded-xl hover:bg-purple-500/20 transition-all border border-purple-500/20"
                      >
                        <Plus size={20} />
                      </button>
                    </div>

                    <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar">
                      {schedules.length === 0 ? (
                        <div className="text-center py-12 bg-slate-800/20 rounded-2xl border border-dashed border-slate-700/50">
                          <Calendar size={32} className="mx-auto mb-3 text-slate-700" />
                          <p className="text-xs text-slate-500 uppercase tracking-widest">Nessuna programmazione</p>
                        </div>
                      ) : (
                        schedules.map(schedule => (
                          <div key={schedule.id} className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50 space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="flex flex-col">
                                  <span className="text-[8px] uppercase font-black text-slate-500 tracking-tighter">Dalle</span>
                                  <input 
                                    type="time" 
                                    value={schedule.startTime}
                                    onChange={(e) => updateSchedule(schedule.id, { startTime: e.target.value })}
                                    className="bg-transparent text-sm font-bold text-white outline-none cursor-pointer"
                                  />
                                </div>
                                <div className="text-slate-700">→</div>
                                <div className="flex flex-col">
                                  <span className="text-[8px] uppercase font-black text-slate-500 tracking-tighter">Alle</span>
                                  <input 
                                    type="time" 
                                    value={schedule.endTime}
                                    onChange={(e) => updateSchedule(schedule.id, { endTime: e.target.value })}
                                    className="bg-transparent text-sm font-bold text-white outline-none cursor-pointer"
                                  />
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <button 
                                  onClick={() => updateSchedule(schedule.id, { enabled: !schedule.enabled })}
                                  className={`w-10 h-5 rounded-full relative transition-all duration-300 ${schedule.enabled ? "bg-purple-500/20 border-purple-500/50" : "bg-slate-700 border-slate-600"} border`}
                                >
                                  <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 ${schedule.enabled ? "right-0.5 bg-purple-400" : "left-0.5 bg-slate-400"}`}></div>
                                </button>
                                <button 
                                  onClick={() => removeSchedule(schedule.id)}
                                  className="flex items-center gap-1.5 text-slate-600 hover:text-red-400 transition-colors bg-red-400/5 px-3 py-1.5 rounded-xl border border-red-400/10"
                                >
                                  <Trash2 size={14} />
                                  <span className="text-[10px] font-bold uppercase tracking-widest">Elimina</span>
                                </button>
                              </div>
                            </div>

                            <div className="flex gap-1 justify-between">
                              {['D', 'L', 'M', 'M', 'G', 'V', 'S'].map((day, idx) => {
                                const isActive = schedule.days.includes(idx);
                                return (
                                  <button
                                    key={idx}
                                    onClick={() => toggleDayInSchedule(schedule.id, idx)}
                                    className={`w-7 h-7 rounded-lg text-[9px] font-black transition-all border ${
                                      isActive 
                                        ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' 
                                        : 'bg-slate-900/50 text-slate-600 border-slate-800 hover:bg-slate-800'
                                    }`}
                                  >
                                    {day}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  {/* Background Persistence (Wake Lock) */}
                  <section className="glass-card rounded-3xl p-6 glow-orange h-full">
                    <h3 className="text-lg md:text-xl font-bold mb-6 flex items-center gap-2 text-white">
                      <Activity size={20} className="text-orange-400" />
                      Keep-Alive
                    </h3>
                    <div className="space-y-6">
                      <div className="p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-xl ${isWakeLockActive ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-700/50 text-slate-600'}`}>
                              <Lock size={18} />
                            </div>
                            <div>
                              <span className="text-sm font-bold text-white uppercase tracking-wider">Wake Lock</span>
                              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-medium">Previene lo standby</p>
                            </div>
                          </div>
                          <button 
                            onClick={toggleWakeLock}
                            className={`w-12 h-6 rounded-full relative transition-all duration-300 ${isWakeLockActive ? "bg-orange-500/20 border-orange-500/50" : "bg-slate-700 border-slate-600"} border`}
                          >
                            <div className={`absolute top-1 w-4 h-4 rounded-full transition-all duration-300 ${isWakeLockActive ? "right-1 bg-orange-400" : "left-1 bg-slate-400"}`}></div>
                          </button>
                        </div>
                        <div className="flex items-start gap-3 p-3 bg-orange-500/5 rounded-xl border border-orange-500/10">
                          <Info size={14} className="text-orange-400 shrink-0 mt-0.5" />
                          <p className="text-[10px] text-slate-400 leading-relaxed uppercase tracking-wider font-medium">
                            Attiva questa modalità su Android per impedire al sistema di chiudere l'app in background. Nota: lo schermo potrebbe rimanere leggermente attivo.
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* WiFi Settings */}
                  <section className="glass-card rounded-3xl p-6 glow-blue">
                    <h3 className="text-lg md:text-xl font-bold mb-6 flex items-center gap-2 text-white">
                      <Wifi size={20} className="text-blue-400" />
                      Rete WiFi Casa
                    </h3>
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <label className="text-[10px] uppercase font-black text-slate-500 tracking-widest block">Nome Rete Predefinita (SSID)</label>
                        <div className="relative">
                          <input 
                            type="text"
                            value={homeWifiName}
                            onChange={(e) => setHomeWifiName(e.target.value)}
                            placeholder="es. WiFi-Casa-Miky"
                            className="w-full bg-slate-900/50 border border-slate-700/50 rounded-2xl p-4 text-white placeholder:text-slate-700 focus:border-blue-500/50 transition-all outline-none"
                          />
                        </div>
                      </div>

                      <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50 flex items-center justify-between">
                        <div>
                          <span className="text-sm font-bold text-white uppercase tracking-wider">Solo su WiFi Casa</span>
                          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-medium">Attiva microfono solo a casa</p>
                        </div>
                        <button 
                          onClick={() => setOnlyOnHomeWifi(!onlyOnHomeWifi)}
                          className={`w-12 h-6 rounded-full relative transition-all duration-300 ${onlyOnHomeWifi ? "bg-blue-500/20 border-blue-500/50" : "bg-slate-700 border-slate-600"} border`}
                        >
                          <div className={`absolute top-1 w-4 h-4 rounded-full transition-all duration-300 ${onlyOnHomeWifi ? "right-1 bg-blue-400" : "left-1 bg-slate-400"}`}></div>
                        </button>
                      </div>
                    </div>
                  </section>
                </div>

                {/* Audio Parameters */}
                <section className="glass-card rounded-3xl p-8 glow-cyan">
                  <div className="flex flex-col xl:flex-row items-center justify-between gap-10">
                    <div className="flex-1 w-full space-y-8">
                      <div className="flex items-center justify-between gap-4">
                        <h3 className="text-xl font-bold flex items-center gap-2 text-white">
                          <Volume2 size={24} className="text-orange-400" />
                          Parametri Audio
                        </h3>
                        <div className="flex items-center gap-3 bg-slate-800/80 px-4 py-2 rounded-xl border border-slate-700">
                          <select 
                            value={voiceLang}
                            onChange={(e) => setVoiceLang(e.target.value)}
                            className="bg-transparent text-xs font-bold text-white uppercase outline-none cursor-pointer"
                          >
                            <option value="it-IT" className="bg-slate-900">Italiano</option>
                            <option value="en-US" className="bg-slate-900">English</option>
                            <option value="de-DE" className="bg-slate-900">Deutsch</option>
                            <option value="fr-FR" className="bg-slate-900">Français</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 w-full">
                        <div className="space-y-4">
                          <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            <span>Volume</span>
                            <span className="text-cyan-400">{volume}%</span>
                          </div>
                          <input type="range" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-full custom-slider" />
                        </div>
                        <button onClick={testVoice} className="px-8 py-4 bg-slate-800 border border-slate-700 rounded-2xl text-xs font-bold uppercase tracking-wider hover:bg-slate-700 transition-all active:scale-95 text-white">
                          Test Voce
                        </button>
                        <div className="flex flex-col gap-3">
                          <button onClick={sendTestNotification} className="px-8 py-4 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl text-xs font-bold uppercase tracking-wider hover:bg-indigo-500/20 transition-all active:scale-95 text-indigo-400 flex items-center justify-center gap-2">
                            <Bell size={14} /> Invia Notifica Push di Test
                          </button>
                          <p className="text-[10px] text-slate-400 text-center uppercase tracking-widest leading-relaxed">
                            Verrà mostrata una notifica di sistema per testare il bridge "End-to-End".
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Voice Commands Guide */}
                <section className="glass-card rounded-3xl p-8 border-indigo-500/20 glow-indigo">
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-white">
                    <Mic2 size={24} className="text-indigo-400" />
                    Guida e comandi vocali
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4 p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50">
                      <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Attivazione</p>
                      <ul className="space-y-2 text-sm">
                        <li className="flex flex-col">
                          <span className="font-bold text-white uppercase text-xs">"LEGGI NOTIFICHE"</span>
                          <span className="text-slate-400 text-[10px]">Attiva la lettura automatica</span>
                        </li>
                        <li className="flex flex-col pt-2">
                          <span className="font-bold text-white uppercase text-xs">"FERMA LETTURA"</span>
                          <span className="text-slate-400 text-[10px]">Pausa la lettura automatica</span>
                        </li>
                      </ul>
                    </div>

                    <div className="space-y-4 p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50">
                      <p className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">Lettura Buffer</p>
                      <ul className="space-y-2 text-sm">
                        <li className="flex flex-col">
                          <span className="font-bold text-white uppercase text-xs">"LEGGI L'ULTIMA NOTIFICA"</span>
                          <span className="text-slate-400 text-[10px]">Riproduce l'ultimo messaggio</span>
                        </li>
                        <li className="flex flex-col pt-2">
                          <span className="font-bold text-white uppercase text-xs">"LEGGI LE ULTIME [N] NOTIFICHE"</span>
                          <span className="text-slate-400 text-[10px]">Es: "Leggi le ultime tre notifiche"</span>
                        </li>
                      </ul>
                    </div>


                  </div>
                  
                  <div className="mt-8">
                    <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex flex-col justify-center">
                      <p className="text-[10px] font-extrabold text-indigo-300 uppercase tracking-widest mb-2 text-center flex items-center justify-center gap-2">
                        <CheckCircle2 size={12} /> URL Webhook
                      </p>
                      <code className="text-[10px] font-mono text-white break-all block bg-slate-900/80 p-3 rounded-xl border border-indigo-500/20 cursor-pointer select-all text-center leading-relaxed font-bold">
                        {webhookUrl}
                      </code>
                    </div>
                  </div>
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Navigation Bar at the Bottom */}
      <aside className="fixed bottom-0 left-0 w-full h-20 glass-card rounded-t-[2.5rem] flex items-center justify-around py-3 px-6 z-50 shadow-[0_-12px_40px_rgba(0,0,0,0.6)] border-t border-slate-700/30">
        <div 
          onClick={toggleListening}
          className={`p-3 cursor-pointer transition-all rounded-2xl relative ${isListening ? "text-cyan-400 bg-cyan-500/10 shadow-lg" : "text-slate-500 hover:text-cyan-400"}`}
        >
          <Mic2 size={24} />
          {isListening && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-[#020617] animate-pulse"></div>}
        </div>
        
        <div 
          onClick={() => setActiveTab("home")}
          className={`p-3 cursor-pointer transition-all rounded-2xl relative ${activeTab === "home" ? "bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20" : "text-slate-500 hover:text-cyan-400"}`}
        >
          <Home size={24} />
        </div>

        <div 
          onClick={() => setActiveTab("settings")}
          className={`p-3 cursor-pointer transition-all rounded-2xl relative ${activeTab === "settings" ? "bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20" : "text-slate-500 hover:text-cyan-400"}`}
        >
          <Settings size={24} />
        </div>

        <div 
          onClick={handleCast}
          className={`p-3 cursor-pointer transition-all rounded-2xl relative flex items-center justify-center ${isCasting ? "text-cyan-400 bg-cyan-500/30 border border-cyan-400/50 scale-110" : "text-slate-500 hover:text-cyan-400"}`}
          style={isCasting ? { boxShadow: '0 0 25px rgba(34, 211, 238, 0.6)' } : {}}
        >
          <Cast size={24} className={isCasting ? "animate-pulse" : ""} strokeWidth={isCasting ? 2.5 : 2} />
          {isCasting && <div className="absolute top-1.5 right-1.5 w-2 h-2 bg-cyan-300 rounded-full border border-[#020617] shadow-[0_0_12px_#22d3ee]"></div>}
        </div>
      </aside>

      {/* App Selection Modal */}
      <AnimatePresence>
        {showAppModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAppModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-[2.5rem] p-6 shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-white">Aggiungi App</h2>
                  <p className="text-xs text-slate-500">Seleziona o digita il nome dell'app</p>
                </div>
                <button 
                  onClick={() => setShowAppModal(false)}
                  className="p-2 text-slate-500 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="relative mb-6">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input 
                  autoFocus
                  placeholder="Cerca app o scrivi nome..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchTerm) {
                      addApp(searchTerm);
                    }
                  }}
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-3 pl-12 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                />
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl mb-4 flex gap-3">
                <Info size={14} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-200/60 leading-tight">
                  Per privacy, il browser non può leggere le app sul telefono. 
                  <span className="text-amber-400 font-bold"> Novità:</span> Il sistema le rileverà automaticamente non appena riceveranno una notifica reale.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {availableApps
                  .filter(app => app.toLowerCase().includes(searchTerm.toLowerCase()))
                  .map(app => (
                    <button
                      key={app}
                      onClick={() => addApp(app)}
                      disabled={!!allowedApps.find(a => a.name.toLowerCase() === app.toLowerCase())}
                      className="flex items-center gap-3 p-3 rounded-2xl bg-slate-800/50 border border-slate-700/30 hover:border-cyan-500/50 hover:bg-slate-800 transition-all group disabled:opacity-30 disabled:hover:border-slate-700/30"
                    >
                      <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-sm shrink-0 group-hover:bg-cyan-500 group-hover:text-slate-950 transition-colors">
                        {app.charAt(0)}
                      </div>
                      <span className="text-xs font-semibold text-white truncate">{app}</span>
                    </button>
                  ))}
                
                {searchTerm && !availableApps.some(a => a.toLowerCase() === searchTerm.toLowerCase()) && (
                  <button
                    onClick={() => addApp(searchTerm)}
                    className="col-span-2 flex items-center gap-3 p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 transition-all text-cyan-400"
                  >
                    <Plus size={18} />
                    <span className="text-xs font-bold uppercase tracking-wider">Aggiungi "{searchTerm}"</span>
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
