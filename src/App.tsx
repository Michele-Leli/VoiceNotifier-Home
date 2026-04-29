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
  Mic2
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

export default function App() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isReadingActive, setIsReadingActive] = useState(() => localStorage.getItem("voiceNotifier_active") === "true");
  const [isListening, setIsListening] = useState(false);
  
  const [allowedApps, setAllowedApps] = useState<AppConfig[]>(() => {
    const saved = localStorage.getItem("voiceNotifier_apps");
    return saved ? JSON.parse(saved) : [
      { name: "WhatsApp", enabled: true },
      { name: "Telegram", enabled: true },
      { name: "Messages", enabled: true }
    ];
  });
  const [volume, setVolume] = useState(() => Number(localStorage.getItem("voiceNotifier_volume") || 50));
  const [voiceLang, setVoiceLang] = useState(() => localStorage.getItem("voiceNotifier_voice") || "it-IT");
  const [isCasting, setIsCasting] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [newAppInput, setNewAppInput] = useState("");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");

  const castSessionRef = useRef<any>(null);
  const recognitionRef = useRef<any>(null);

  // Persistence
  useEffect(() => {
    localStorage.setItem("voiceNotifier_apps", JSON.stringify(allowedApps));
  }, [allowedApps]);

  useEffect(() => {
    localStorage.setItem("voiceNotifier_volume", volume.toString());
  }, [volume]);

  useEffect(() => {
    localStorage.setItem("voiceNotifier_voice", voiceLang);
  }, [voiceLang]);

  useEffect(() => {
    localStorage.setItem("voiceNotifier_active", isReadingActive.toString());
  }, [isReadingActive]);

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/webhook`);
  }, []);

  const readOutLoud = useCallback((notif: Notification) => {
    if (!castSessionRef.current || !isCasting) return;

    const textToRead = `Nuova notifica da ${notif.app}. ${notif.title ? notif.title + ' dice: ' : ''} ${notif.message}`;
    const encodedText = encodeURIComponent(textToRead);
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${voiceLang}&client=tw-ob&q=${encodedText}`;

    const mediaInfo = new (window as any).chrome.cast.media.MediaInfo(ttsUrl, "audio/mp3");
    const request = new (window as any).chrome.cast.media.LoadRequest(mediaInfo);
    
    castSessionRef.current.setVolume(volume / 100);
    castSessionRef.current.loadMedia(request).catch((e: any) => console.error("Cast error", e));
  }, [voiceLang, volume, isCasting]);

  const processNotification = useCallback((notif: Notification, force: boolean = false) => {
    const config = allowedApps.find(a => a.name.toLowerCase() === notif.app.toLowerCase());
    if (config?.enabled && (isReadingActive || force)) {
      readOutLoud(notif);
    }
  }, [allowedApps, isReadingActive, readOutLoud]);

  // Voice Recognition setup
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'it-IT';

      rec.onresult = (event: any) => {
        const result = event.results[event.results.length - 1][0].transcript.toLowerCase();
        console.log("Voice Command:", result);
        
        if (result.includes("inizia a leggere") || result.includes("attiva lettura")) {
          setIsReadingActive(true);
        } else if (result.includes("ferma la lettura") || result.includes("disattiva lettura")) {
          setIsReadingActive(false);
        }
      };

      rec.onstart = () => setIsListening(true);
      rec.onend = () => setIsListening(false);
      recognitionRef.current = rec;
      
      // Auto-start listening if enabled
      rec.start();
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
    }
  };

  // Socket connection
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on("notification", (data: Notification) => {
      setNotifications(prev => [data, ...prev].slice(0, 50));
      processNotification(data);
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

    return () => {
      newSocket.close();
    };
  }, [processNotification]);

  const readHistory = () => {
    const toRead = [...notifications].reverse().slice(0, 5); // Read last 5 for safety
    toRead.forEach((n, index) => {
      setTimeout(() => {
        processNotification(n, true);
      }, index * 5000); // Wait 5s between each
    });
    setUnreadCount(0);
  };

  // Google Cast Initialization
  useEffect(() => {
    const checkCast = () => {
      if (typeof window !== "undefined" && (window as any).cast) {
        const castContext = (window as any).cast.framework.CastContext.getInstance();
        castContext.setOptions({
          receiverApplicationId: (window as any).chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: (window as any).chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
        });

        castContext.addEventListener(
          (window as any).cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
          (event: any) => {
            switch (event.sessionState) {
              case (window as any).cast.framework.SessionState.SESSION_STARTED:
              case (window as any).cast.framework.SessionState.SESSION_RESUMED:
                castSessionRef.current = castContext.getCurrentSession();
                setIsCasting(true);
                setDeviceName(castSessionRef.current.getCastDevice().friendlyName);
                break;
              case (window as any).cast.framework.SessionState.SESSION_ENDED:
                setIsCasting(false);
                setDeviceName(null);
                castSessionRef.current = null;
                break;
            }
          }
        );
      }
    };

    const timer = setTimeout(checkCast, 1000);
    return () => clearTimeout(timer);
  }, []);

  const handleCast = () => {
    if (typeof window !== "undefined" && (window as any).cast) {
      (window as any).cast.framework.CastContext.getInstance().requestSession();
    }
  };

  const addApp = (e: React.FormEvent) => {
    e.preventDefault();
    if (newAppInput.trim() && !allowedApps.find(a => a.name.toLowerCase() === newAppInput.toLowerCase())) {
      setAllowedApps([...allowedApps, { name: newAppInput.trim(), enabled: true }]);
      setNewAppInput("");
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
      readOutLoud(testNotif);
    } else {
      const utterance = new SpeechSynthesisUtterance(testNotif.message);
      utterance.lang = voiceLang;
      utterance.volume = volume / 100;
      window.speechSynthesis.speak(utterance);
    }
  };
  return (
    <div className="flex flex-col h-screen w-full bg-[#020617] text-slate-200 overflow-hidden font-sans">
      {/* Main Content */}
      <main className="flex-1 flex flex-col p-4 md:p-8 overflow-y-auto custom-scrollbar">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 pb-8 mb-4 border-b border-slate-800">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-2">
              VoxHome <span className="text-cyan-400">Bridge</span>
            </h1>
            <p className="text-slate-400 text-sm flex items-center gap-2">
              <Activity size={14} className="text-cyan-500" />
              Phone-to-Google Home notification relay
            </p>
          </div>
          
          <div className={`flex items-center gap-3 px-6 py-2 glass-card rounded-full border-2 transition-all ${isCasting ? "border-cyan-500/50 glow-cyan" : "border-slate-800"}`}>
            <div className={`w-2 h-2 rounded-full ${isCasting ? "bg-cyan-400 shadow-[0_0_8px_#22d3ee]" : "bg-slate-600"}`}></div>
            <span className={`text-xs font-bold tracking-wider uppercase ${isCasting ? "text-cyan-400" : "text-slate-500"}`}>
              {isCasting ? `Connesso a ${deviceName}` : "In attesa di Cast"}
            </span>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* App Triggers */}
          <section className="lg:col-span-12 xl:col-span-7 glass-card rounded-3xl p-6 glow-cyan">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <Smartphone size={20} className="text-cyan-400" /> 
                App Monitorate
              </h3>
              <form onSubmit={addApp} className="flex gap-2">
                <input 
                  value={newAppInput}
                  onChange={(e) => setNewAppInput(e.target.value)}
                  placeholder="Nome App..."
                  className="bg-slate-800/50 border border-slate-700/50 px-4 py-2 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 w-32 md:w-48"
                />
                <button type="submit" className="bg-cyan-500 text-slate-950 p-2 rounded-xl hover:bg-cyan-400 transition-colors">
                  <Plus size={20} />
                </button>
              </form>
            </div>

            <div className="space-y-3 h-[280px] overflow-y-auto pr-2 custom-scrollbar">
              <AnimatePresence initial={false}>
                {allowedApps.map(app => (
                  <motion.div 
                    key={app.name}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex items-center justify-between p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50 group"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg ${app.enabled ? "bg-cyan-500/20 text-cyan-400" : "bg-slate-700/20 text-slate-500"}`}>
                        {app.name.charAt(0)}
                      </div>
                      <div>
                        <p className={`font-semibold ${app.enabled ? "text-white" : "text-slate-500 line-through"}`}>{app.name}</p>
                        <p className="text-xs text-slate-500">Notifiche inoltrate al bridge</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => toggleApp(app.name)}
                        className={`w-12 h-6 rounded-full relative transition-all duration-300 ${app.enabled ? "bg-cyan-500/20 border-cyan-500/50" : "bg-slate-700 border-slate-600"} border`}
                      >
                        <div className={`absolute top-1 w-4 h-4 rounded-full transition-all duration-300 ${app.enabled ? "right-1 bg-cyan-400" : "left-1 bg-slate-400"}`}></div>
                      </button>
                      <button 
                        onClick={() => removeApp(app.name)}
                        className="text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 p-1"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </section>

          {/* Webhook Info */}
          <section className="lg:col-span-12 xl:col-span-5 glass-card rounded-3xl p-6 glow-indigo flex flex-col">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Activity size={20} className="text-indigo-400" />
              Configurazione Bridge
            </h3>
            
            <div className="flex-1 space-y-6">
              <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20">
                <p className="text-xs font-bold text-indigo-300 uppercase tracking-widest mb-2">Endpoint Webhook</p>
                <code className="text-sm font-mono text-white break-all block mb-3 bg-slate-900/50 p-3 rounded-xl border border-indigo-500/10 cursor-pointer select-all" title="Click to select all">
                  {webhookUrl}
                </code>
                <p className="text-[10px] text-indigo-300/70 italic">Usa questo URL nelle tue automazioni (Tasker, Automate, Macrodroid) per inviare notifiche.</p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="bg-indigo-500/20 p-2 rounded-xl text-indigo-400">
                      <Play size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">Stato Lettura</p>
                      <p className="text-[10px] text-slate-500 uppercase tracking-tighter">{isReadingActive ? "Attivo (Voice Controlled)" : "Inattivo"}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsReadingActive(!isReadingActive)}
                    className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${isReadingActive ? "bg-red-500/20 text-red-500 border border-red-500/30" : "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/40"}`}
                  >
                    {isReadingActive ? "Disattiva" : "Attiva"}
                  </button>
                </div>

                <div className="pt-4 border-t border-slate-700/50 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-orange-500/20 p-2 rounded-xl text-orange-400">
                        <Activity size={18} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">Notifiche Arretrate</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-tighter">{unreadCount} non lette nel buffer</p>
                      </div>
                    </div>
                    <button 
                      onClick={readHistory}
                      disabled={unreadCount === 0 || !isCasting}
                      className="px-4 py-1.5 bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-orange-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                      Leggi Ora
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${isListening ? "bg-red-500 shadow-[0_0_8px_#ef4444]" : "bg-slate-600"}`}></div>
                  <p className="text-xs font-bold text-white leading-tight">Controllo Vocale</p>
                </div>
                <p className="text-[10px] text-slate-500 italic">"Hey Google, inizia a leggere" per attivare.</p>
              </div>

              <button 
                onClick={handleCast}
                className="w-full py-4 mt-auto border border-dashed border-slate-600 rounded-2xl text-slate-500 text-xs font-bold tracking-widest uppercase hover:text-slate-300 hover:border-indigo-400 hover:bg-slate-800/20 transition-all flex items-center justify-center gap-2"
              >
                <Cast size={16} /> 
                {isCasting ? "Cambia Dispositivo" : "Cerca Google Home"}
              </button>
            </div>
          </section>

          {/* Audio Config */}
          <section className="lg:col-span-12 glass-card rounded-3xl p-8 glow-cyan">
             <div className="flex flex-col xl:flex-row items-center justify-between gap-10">
                <div className="flex-1 w-full space-y-8">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-xl font-bold flex items-center gap-2">
                       <Volume2 size={20} className="text-orange-400" />
                       Parametri Audio
                    </h3>
                    <div className="flex items-center gap-3 bg-slate-800/80 px-4 py-2 rounded-xl border border-slate-700">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Voce:</span>
                      <select 
                        value={voiceLang}
                        onChange={(e) => setVoiceLang(e.target.value)}
                        className="bg-transparent text-xs font-bold text-white uppercase tracking-wider outline-none cursor-pointer"
                      >
                        <option value="it-IT" className="bg-slate-900">Italiano</option>
                        <option value="en-US" className="bg-slate-900">English US</option>
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
                      <input 
                        type="range" 
                        value={volume} 
                        onChange={(e) => setVolume(Number(e.target.value))}
                        className="w-full custom-slider"
                      />
                    </div>
                    <div className="space-y-4">
                      <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        <span>Latenza Stimata</span>
                        <span className="text-indigo-400">&lt; 0.5s</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="w-1/3 h-full bg-gradient-to-r from-cyan-500 to-indigo-500 rounded-full"></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="hidden xl:block w-[1px] h-20 bg-slate-800"></div>

                <button 
                  onClick={testVoice}
                  className="w-full xl:w-auto px-12 py-6 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 rounded-2xl font-bold text-lg shadow-xl shadow-cyan-500/20 active:scale-95 transition-all flex items-center justify-center gap-3 shrink-0"
                >
                  Test Output <Play size={24} fill="currentColor" />
                </button>
             </div>
          </section>

          {/* Logs */}
          <section className="lg:col-span-12 glass-card rounded-3xl p-6 glow-indigo">
             <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <Activity size={20} className="text-slate-400" />
                  Storico Attività
                </h3>
                <span className="text-[10px] font-bold px-3 py-1 glass-card border-cyan-500/30 text-cyan-400 rounded-full uppercase tracking-widest">
                  Live Feed
                </span>
             </div>

             <div className="space-y-3 h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                <AnimatePresence initial={false}>
                   {notifications.length === 0 ? (
                     <div className="h-full flex flex-col items-center justify-center text-slate-600 py-10">
                        <Bell size={40} strokeWidth={1} className="mb-4 opacity-20" />
                        <p className="text-sm font-medium">Nessuna notifica ricevuta...</p>
                     </div>
                   ) : (
                     notifications.map((notif, i) => (
                       <motion.div 
                        key={notif.timestamp + i}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="p-4 rounded-2xl bg-slate-800/30 border border-slate-700/30 flex items-center gap-6"
                       >
                          <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0 uppercase">
                            {notif.app.substring(0, 3)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                               <span className="text-sm font-bold text-white">{notif.title}</span>
                               <span className="text-[10px] font-medium text-slate-500">{new Date(notif.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <p className="text-sm text-slate-400 truncate">{notif.message}</p>
                          </div>
                          <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] shrink-0"></div>
                       </motion.div>
                     ))
                   )}
                </AnimatePresence>
             </div>
          </section>
        </div>
      </main>

      {/* Navigation Bar at the Bottom */}
      <aside className="w-full h-20 md:h-24 glass-card rounded-t-3xl flex items-center justify-between py-4 px-8 z-10 shadow-[0_-8px_32px_rgba(0,0,0,0.4)]">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20 text-slate-950 shrink-0">
            <Bell size={20} />
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-bold text-white">VoxHome</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest">Active Bridge</p>
          </div>
        </div>
        
        <nav className="flex gap-8 md:gap-12 items-center">
          <div 
            onClick={toggleListening}
            className={`p-3 cursor-pointer transition-all rounded-xl hover:bg-slate-800/50 ${isListening ? "text-red-400" : "text-slate-500 hover:text-cyan-400"}`}
            title={isListening ? "Microfono Attivo" : "Microfono Spento"}
          >
            {isListening ? <Mic2 size={24} /> : <div className="relative"><Mic2 size={24} /><div className="absolute top-0 right-0 w-2 h-2 bg-slate-500 rounded-full border border-[#020617]"></div></div>}
          </div>
          <div 
            onClick={() => setIsReadingActive(!isReadingActive)}
            className={`p-3 cursor-pointer transition-all rounded-xl hover:bg-slate-800/50 ${isReadingActive ? "text-cyan-400" : "text-slate-500 hover:text-cyan-400"}`}
            title={isReadingActive ? "Lettura Notifiche Attiva" : "Lettura Notifiche Disattivata"}
          >
            {isReadingActive ? <Play size={24} /> : <div className="relative"><Play size={24} className="rotate-90" /><div className="absolute top-0 right-0 w-2 h-2 bg-slate-500 rounded-full border border-[#020617]"></div></div>}
          </div>
          <div className="p-3 text-cyan-400 cursor-pointer transition-colors bg-cyan-500/10 rounded-xl">
            <Home size={24} />
          </div>
          <div 
            onClick={handleCast}
            className={`p-3 cursor-pointer transition-all rounded-xl hover:bg-slate-800/50 ${isCasting ? "text-cyan-400" : "text-slate-500 hover:text-cyan-400"}`}
          >
            <Cast size={24} />
          </div>
        </nav>

        <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0">
          <Smartphone size={20} className="text-slate-400" />
        </div>
      </aside>
    </div>
  );
}
