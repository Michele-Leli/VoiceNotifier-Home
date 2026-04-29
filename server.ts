import express from "express";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import http from "http";
import path from "path";
import cors from "cors";

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

  // Notification buffer to store messages for clients that connect later
  const notificationBuffer: Notification[] = [];
  const MAX_BUFFER = 20;

  // Webhook for phone notifications
  app.post("/api/webhook", (req, res) => {
    const { app: appName, title, message } = req.body;
    
    if (!appName || !message) {
      return res.status(400).json({ error: "Missing 'app' or 'message' field" });
    }

    const newNotification = { 
      app: appName, 
      title: title || "", 
      message, 
      timestamp: Date.now(),
      id: Math.random().toString(36).substr(2, 9)
    };

    // Add to buffer
    notificationBuffer.push(newNotification);
    if (notificationBuffer.length > MAX_BUFFER) {
      notificationBuffer.shift();
    }

    // Broadcast to active clients
    io.emit("notification", newNotification);
    
    res.json({ status: "ok", received: newNotification });
  });

  io.on("connection", (socket) => {
    console.log("Client connected, sending buffer:", notificationBuffer.length);
    socket.emit("buffer_sync", notificationBuffer);
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
