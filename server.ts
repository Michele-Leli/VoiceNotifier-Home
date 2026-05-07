import express from "express";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import http from "http";
import path from "path";
import cors from "cors";
import webpush from "web-push";
import fs from "fs";

interface AppNotification {
  app: string;
  title: string;
  message: string;
  timestamp: number;
}

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// Persistenza chiavi VAPID e Sottoscrizioni
const VAPID_FILE = path.join(process.cwd(), "vapid-keys.json");
const SUBS_FILE = path.join(process.cwd(), "subscriptions.json");

let vapidKeys = { publicKey: "", privateKey: "" };
let subscriptions: PushSubscription[] = [];

function loadPersistedData() {
  if (fs.existsSync(VAPID_FILE)) {
    try {
      const data = fs.readFileSync(VAPID_FILE, "utf-8");
      if (data) {
        vapidKeys = JSON.parse(data);
        console.log("VAPID: Chiavi caricate correttamente");
      }
    } catch (e) {
      console.error("VAPID: Errore lettura chiavi", e);
    }
  }

  if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
    vapidKeys = webpush.generateVAPIDKeys();
    try {
      fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys));
      console.log("VAPID: Nuove chiavi generate e salvate");
    } catch (e) {
      console.error("VAPID: Errore salvataggio chiavi", e);
    }
  }

  webpush.setVapidDetails(
    "mailto:michele.leli.80@gmail.com",
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );

  // Carica Sottoscrizioni
  if (fs.existsSync(SUBS_FILE)) {
    try {
      const data = fs.readFileSync(SUBS_FILE, "utf-8");
      if (data) {
        subscriptions = JSON.parse(data);
        console.log(`Subscriptions: Caricate ${subscriptions.length} sottoscrizioni`);
      }
    } catch (e) {
      console.warn("Subscriptions: Errore caricamento file");
    }
  }
}

function saveSubscriptions() {
  try {
    fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions));
  } catch (e) {
    console.error("Subscriptions: Errore salvataggio", e);
  }
}

loadPersistedData();

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Notification buffer and tracking
  const notificationBuffer: AppNotification[] = [];
  const processedHashes = new Set<string>();
  const discoveredApps = new Set<string>(["WhatsApp", "VoxHome Bridge", "IFTTT", "Telegram", "Gmail", "Instagram", "Slack", "Discord"]);
  const MAX_BUFFER = 20;

  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      subscriptions: subscriptions.length, 
      vapidKey: vapidKeys.publicKey.substring(0, 10) + "..." 
    });
  });

  app.get("/api/vapid-public-key", (req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  app.post("/api/subscribe", (req, res) => {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: "Sottoscrizione non valida" });
    }

    const existingIdx = subscriptions.findIndex(s => s.endpoint === subscription.endpoint);
    if (existingIdx === -1) {
      subscriptions.push(subscription);
      console.log(`Subscriptions: Nuova iscrizione! Totale: ${subscriptions.length}`);
    } else {
      subscriptions[existingIdx] = subscription;
      console.log("Subscriptions: Iscrizione esistente aggiornata");
    }
    saveSubscriptions();
    res.status(201).json({});
  });

  app.post("/api/test-push", async (req, res) => {
    const testNotif = {
      app: "VoxHome Test",
      title: "Test Push",
      message: "Test di notifica push reale inviato dal server.",
      timestamp: Date.now()
    };
    
    console.log(`Push: Invio test a ${subscriptions.length} client...`);
    const payload = JSON.stringify(testNotif);
    
    let successCount = 0;
    let goneCount = 0;

    for (let i = subscriptions.length - 1; i >= 0; i--) {
      const sub = subscriptions[i];
      try {
        await webpush.sendNotification(sub as any, payload);
        successCount++;
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          console.log(`Push: Endpoint rimosso (${err.statusCode})`);
          subscriptions.splice(i, 1);
          goneCount++;
        } else {
          console.error(`Push: Errore per ${sub.endpoint}:`, err.message);
        }
      }
    }
    
    if (goneCount > 0) saveSubscriptions();
    res.json({ status: "ok", successful: successCount, removed: goneCount, total: subscriptions.length });
  });

  // Webhook for phone notifications
  app.post("/api/webhook", async (req, res) => {
    console.log("Webhook: Payload ricevuto:", JSON.stringify(req.body));
    
    // Supporto per vari formati di payload (Automate, Tasker, IFTTT)
    const appName = req.body.app || req.body.appName || req.body.app_name || "IFTTT";
    const message = req.body.message || req.body.msg || req.body.text || req.body.value1 || "";
    const title = req.body.title || "Notifica";
    
    if (!message) {
      console.warn("Webhook: Nessun messaggio trovato nel payload, ignoro.");
      return res.status(400).json({ error: "Missing message content" });
    }

    // Deduplication check
    const hash = `${appName}:${message}:${Math.floor(Date.now() / 2000)}`;
    if (processedHashes.has(hash)) {
      console.log("Webhook: Duplicato ignorato (Backend Check)");
      return res.json({ status: "skipped", reason: "duplicate" });
    }
    processedHashes.add(hash);
    setTimeout(() => processedHashes.delete(hash), 10000);

    const newNotification: AppNotification = { 
      app: appName, 
      title: title, 
      message: String(message), 
      timestamp: Date.now()
    };

    notificationBuffer.push(newNotification);
    if (notificationBuffer.length > MAX_BUFFER) notificationBuffer.shift();

    // 1. Broadcast via Socket.io
    io.emit("notification", newNotification);

    // 2. Broadcast via Push
    const payload = JSON.stringify(newNotification);
    console.log(`Push: Notifico "${newNotification.app}" a ${subscriptions.length} client`);
    
    let goneCount = 0;
    for (let i = subscriptions.length - 1; i >= 0; i--) {
      try {
        await webpush.sendNotification(subscriptions[i] as any, payload);
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          subscriptions.splice(i, 1);
          goneCount++;
        }
      }
    }

    if (goneCount > 0) {
      console.log(`Push: Rimosse ${goneCount} sottoscrizioni scadute.`);
      saveSubscriptions();
    }
    
    res.json({ status: "ok", notified: subscriptions.length, received: newNotification });
  });

  io.on("connection", (socket) => {
    socket.emit("buffer_sync", notificationBuffer);
    socket.emit("discovered_apps", Array.from(discoveredApps));
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
