// server.js
import express from "express";
import cors from "cors";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia, Location, Contact } = pkg;

// Log available features
console.log("WhatsApp Web.js version loaded");
console.log("Available features:", {
  hasClient: !!Client,
  hasLocalAuth: !!LocalAuth,
  hasMessageMedia: !!MessageMedia,
  hasLocation: !!Location,
  hasContact: !!Contact,
});
import qrcode from "qrcode";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = "MAHAD";

// Middleware
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cors());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-API-Key"],
  })
);

// API Key validation middleware
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
};

// Store client instances and their states
const sessions = new Map();
const qrCodes = new Map();

// Health monitoring for automatic cleanup
const healthMonitor = {
  failedRequests: 0,
  maxFailedRequests: 2,
  isMonitoring: false,

  startMonitoring() {
    if (this.isMonitoring) return;
    this.isMonitoring = true;

    // Check health every 30 seconds
    setInterval(() => {
      this.checkHealth();
    }, 30000);

    console.log(
      "🔍 Health monitoring started - will auto-cleanup if server becomes unresponsive"
    );
  },

  async checkHealth() {
    try {
      // Simple health check - if this fails, server might be stuck
      const response = await fetch(`http://localhost:${PORT}/ping`);
      if (response.ok) {
        this.failedRequests = 0; // Reset counter on successful response
      } else {
        this.failedRequests++;
      }
    } catch (error) {
      this.failedRequests++;
      console.warn(
        `⚠️ Health check failed (${this.failedRequests}/${this.maxFailedRequests}):`,
        error.message
      );

      if (this.failedRequests >= this.maxFailedRequests) {
        console.log(
          "🚨 Server appears unresponsive - initiating automatic cleanup..."
        );
        await this.performCleanup();
      }
    }
  },

  async performCleanup() {
    try {
      console.log("🧹 Performing automatic cleanup...");

      // Stop all sessions gracefully
      for (const [sessionId, session] of sessions) {
        try {
          if (session.client) {
            await session.client.destroy();
          }
        } catch (error) {
          console.warn(
            `Warning during cleanup for session ${sessionId}:`,
            error.message
          );
        }
      }

      // Clear sessions
      sessions.clear();
      qrCodes.clear();

      // Clean up auth files
      const fs = require("fs");
      const path = require("path");
      const authDir = path.join(__dirname, ".wwebjs_auth");

      if (fs.existsSync(authDir)) {
        try {
          fs.rmSync(authDir, { recursive: true, force: true });
          console.log("✅ Authentication files cleaned up automatically");
        } catch (cleanupError) {
          console.warn(
            "⚠️ Could not clean up auth files:",
            cleanupError.message
          );
        }
      }

      // Reset monitoring
      this.failedRequests = 0;
      console.log("🔄 Server reset - ready for new connections");
    } catch (error) {
      console.error("❌ Error during automatic cleanup:", error);
    }
  },
};

// WhatsApp Client Class
class WhatsAppSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.client = null;
    this.status = "disconnected";
    this.qrCode = null;
    this.isReady = false;
  }

  async initialize() {
    try {
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: this.sessionId,
          dataPath: `./.wwebjs_auth/${this.sessionId}`,
        }),
        puppeteer: {
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--single-process",
            "--disable-gpu",
          ],
        },
      });

      this.setupEventHandlers();
      await this.client.initialize();

      return { success: true, message: "Session initialized" };
    } catch (error) {
      console.error(`Error initializing session ${this.sessionId}:`, error);
      this.status = "error";
      throw error;
    }
  }

  setupEventHandlers() {
    this.client.on("qr", async (qr) => {
      console.log(`QR Code generated for session: ${this.sessionId}`);
      this.status = "qr_code";
      this.qrCode = qr;

      // Generate QR code image
      try {
        const qrImage = await qrcode.toDataURL(qr);
        qrCodes.set(this.sessionId, qrImage);
      } catch (error) {
        console.error("Error generating QR code image:", error);
      }
    });

    this.client.on("ready", () => {
      console.log(`WhatsApp session ${this.sessionId} is ready!`);
      this.status = "connected";
      this.isReady = true;
      this.qrCode = null;
    });

    this.client.on("authenticated", () => {
      console.log(`Session ${this.sessionId} authenticated`);
      this.status = "authenticated";
    });

    this.client.on("auth_failure", (msg) => {
      console.error(
        `Authentication failed for session ${this.sessionId}:`,
        msg
      );
      this.status = "auth_failure";
    });

    this.client.on("disconnected", (reason) => {
      console.log(`Session ${this.sessionId} disconnected:`, reason);
      this.status = "disconnected";
      this.isReady = false;
    });

    this.client.on("error", (error) => {
      console.error(`Session ${this.sessionId} error:`, error);
      this.status = "error";
      this.isReady = false;
    });

    this.client.on("message", (message) => {
      console.log(
        `Message received in session ${this.sessionId}:`,
        message.body
      );
    });
  }

  async sendMessage(chatId, contentType, content, options = {}) {
    console.log("Options:", options);
    if (!this.isReady) {
      throw new Error("WhatsApp client is not ready");
    }

    try {
      let result;

      switch (contentType) {
        case "string":
          result = await this.client.sendMessage(chatId, content);
          break;

        case "MessageMedia":
          const media = new MessageMedia(
            content.mimetype,
            content.data,
            content.filename
          );
          result = await this.client.sendMessage(chatId, media, {
            caption: options.caption,
          });
          break;

        case "MessageMediaFromURL":
          const mediaFromUrl = await MessageMedia.fromUrl(content, options);
          result = await this.client.sendMessage(chatId, mediaFromUrl);
          break;

        case "Location":
          const location = new Location(
            content.latitude,
            content.longitude,
            content.description
          );
          result = await this.client.sendMessage(chatId, location);
          break;

        case "Contact":
          try {
            const contact = await this.client.getContactById(content.contactId);
            result = await this.client.sendMessage(chatId, contact);
          } catch (error) {
            // Fallback for older versions
            result = await this.client.sendMessage(
              chatId,
              `Contact: ${content.contactId}`
            );
          }
          break;

        default:
          throw new Error(`Unsupported content type: ${contentType}`);
      }

      return {
        success: true,
        messageId: result.id._serialized,
        timestamp: result.timestamp,
      };
    } catch (error) {
      console.error(
        `Error sending message in session ${this.sessionId}:`,
        error
      );
      throw error;
    }
  }

  async stop() {
    try {
      if (this.client) {
        // Gracefully destroy the client
        try {
          await this.client.destroy();
        } catch (destroyError) {
          console.warn(
            `Warning: Error during client destroy for session ${this.sessionId}:`,
            destroyError.message
          );
          // Force cleanup if destroy fails
          this.client = null;
        }
        this.status = "disconnected";
        this.isReady = false;
        this.qrCode = null;
      }
      return { success: true, message: "Session stopped" };
    } catch (error) {
      console.error(`Error stopping session ${this.sessionId}:`, error);
      // Don't throw error, just log it and return success
      return { success: true, message: "Session stopped with warnings" };
    }
  }

  async restart() {
    try {
      await this.stop();
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
      return await this.initialize();
    } catch (error) {
      console.error(`Error restarting session ${this.sessionId}:`, error);
      throw error;
    }
  }

  getStatus() {
    return {
      sessionId: this.sessionId,
      status: this.status,
      isReady: this.isReady,
      hasQrCode: !!this.qrCode,
    };
  }
}

// Helper function to get or create session
const getSession = (sessionId) => {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new WhatsAppSession(sessionId));
  }
  return sessions.get(sessionId);
};

// Routes

// Ping endpoint
app.get("/ping", (req, res) => {
  res.json({
    success: true,
    message: "WhatsApp server is running",
    timestamp: new Date(),
  });
});

// Session Status
app.get("/session/status/:sessionId", validateApiKey, (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.json({
        sessionId,
        status: "not_initialized",
        isReady: false,
        hasQrCode: false,
      });
    }

    res.json(session.getStatus());
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start Session
app.get("/session/start/:sessionId", validateApiKey, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = getSession(sessionId);

    if (session.status === "connected" || session.status === "qr_code") {
      return res.json({
        success: true,
        message: "Session already active",
        status: session.status,
      });
    }

    const result = await session.initialize();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stop Session
app.get("/session/stop/:sessionId", validateApiKey, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.json({ success: true, message: "Session not found" });
    }

    const result = await session.stop();
    sessions.delete(sessionId);
    qrCodes.delete(sessionId);

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Restart Session
app.get("/session/restart/:sessionId", validateApiKey, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = getSession(sessionId);

    const result = await session.restart();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get QR Code (Text)
app.get("/session/qr/:sessionId", validateApiKey, (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session || !session.qrCode) {
      return res
        .status(404)
        .json({ success: false, error: "QR code not available" });
    }

    res.json({ success: true, qrCode: session.qrCode });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get QR Code (Image)
app.get("/session/qr/:sessionId/image", validateApiKey, (req, res) => {
  try {
    const { sessionId } = req.params;
    const qrImage = qrCodes.get(sessionId);

    if (!qrImage) {
      return res
        .status(404)
        .json({ success: false, error: "QR code image not available" });
    }

    // Convert base64 to buffer and send as PNG
    const base64Data = qrImage.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Request Pairing Code
app.post(
  "/session/requestPairingCode/:sessionId",
  validateApiKey,
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { phoneNumber } = req.body;

      const session = getSession(sessionId);

      if (!session.client) {
        return res
          .status(400)
          .json({ success: false, error: "Session not initialized" });
      }

      // Request pairing code
      const pairingCode = await session.client.requestPairingCode(phoneNumber);

      res.json({
        success: true,
        pairingCode,
        message: "Pairing code generated successfully",
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Send Message (Universal endpoint)
app.post("/client/sendMessage/:sessionId", validateApiKey, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { chatId, contentType, content, options = {} } = req.body;

    const session = sessions.get(sessionId);

    if (!session) {
      return res
        .status(404)
        .json({ success: false, error: "Session not found" });
    }

    if (!session.isReady) {
      return res
        .status(400)
        .json({ success: false, error: "Session not ready" });
    }

    const result = await session.sendMessage(
      chatId,
      contentType,
      content,
      options
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send message with media (for bill images)
app.post(
  "/message/media-base64/:sessionId",
  validateApiKey,
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { phoneNumber, mediaData, mimeType, filename, caption } = req.body;

      const session = sessions.get(sessionId);
      if (!session?.isReady) {
        return res
          .status(400)
          .json({ success: false, error: "Session not ready" });
      }

      const chatId = phoneNumber + "@c.us";
      const result = await session.sendMessage(chatId, "MessageMedia", {
        mimetype: mimeType,
        data: mediaData,
        filename: filename,
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Send text message
app.post("/message/text/:sessionId", validateApiKey, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { phoneNumber, message } = req.body;

    const session = sessions.get(sessionId);
    if (!session?.isReady) {
      return res
        .status(400)
        .json({ success: false, error: "Session not ready" });
    }

    const chatId = phoneNumber + "@c.us";
    const result = await session.sendMessage(chatId, "string", message);

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get All Sessions
app.get("/sessions", validateApiKey, (req, res) => {
  try {
    const allSessions = Array.from(sessions.entries()).map(([id, session]) => ({
      sessionId: id,
      ...session.getStatus(),
    }));

    res.json({ success: true, sessions: allSessions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Client Info
app.get("/client/info/:sessionId", validateApiKey, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session || !session.isReady) {
      return res
        .status(400)
        .json({ success: false, error: "Session not ready" });
    }

    const info = session.client.info;
    res.json({
      success: true,
      clientInfo: {
        wid: info.wid,
        pushname: info.pushname,
        me: info.me,
        platform: info.platform,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Chat Info
app.get("/client/chat/:sessionId/:chatId", validateApiKey, async (req, res) => {
  try {
    const { sessionId, chatId } = req.params;
    const session = sessions.get(sessionId);

    if (!session || !session.isReady) {
      return res
        .status(400)
        .json({ success: false, error: "Session not ready" });
    }

    const chat = await session.client.getChatById(chatId);
    res.json({
      success: true,
      chat: {
        id: chat.id,
        name: chat.name,
        isGroup: chat.isGroup,
        unreadCount: chat.unreadCount,
        timestamp: chat.timestamp,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Contact Info
app.get(
  "/client/contact/:sessionId/:contactId",
  validateApiKey,
  async (req, res) => {
    try {
      const { sessionId, contactId } = req.params;
      const session = sessions.get(sessionId);

      if (!session || !session.isReady) {
        return res
          .status(400)
          .json({ success: false, error: "Session not ready" });
      }

      const contact = await session.client.getContactById(contactId);
      res.json({
        success: true,
        contact: {
          id: contact.id,
          name: contact.name,
          pushname: contact.pushname,
          number: contact.number,
          isMe: contact.isMe,
          isUser: contact.isUser,
          isGroup: contact.isGroup,
          isWAContact: contact.isWAContact,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "WhatsApp server is healthy",
    uptime: process.uptime(),
    timestamp: new Date(),
    activeSessions: sessions.size,
    healthMonitor: {
      isMonitoring: healthMonitor.isMonitoring,
      failedRequests: healthMonitor.failedRequests,
      maxFailedRequests: healthMonitor.maxFailedRequests,
    },
  });
});

// Manual cleanup endpoint
app.post("/cleanup", validateApiKey, async (req, res) => {
  try {
    console.log("🧹 Manual cleanup requested");
    await healthMonitor.performCleanup();
    res.json({
      success: true,
      message: "Manual cleanup completed successfully",
      timestamp: new Date(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Cleanup failed",
      message: error.message,
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
  });
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down WhatsApp server...");

  // Close all sessions
  for (const [sessionId, session] of sessions) {
    try {
      if (session.client) {
        await session.client.destroy();
      }
    } catch (error) {
      console.error(`Error closing session ${sessionId}:`, error);
    }
  }

  process.exit(0);
});

// Handle uncaught exceptions to prevent crashes
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  console.log("Server will continue running...");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  console.log("Server will continue running...");
});

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down gracefully...");

  // Close all sessions
  for (const [sessionId, session] of sessions) {
    try {
      if (session.client) {
        await session.client.destroy();
      }
    } catch (error) {
      console.error(`Error closing session ${sessionId}:`, error);
    }
  }

  process.exit(0);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`WhatsApp Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`API Key: ${API_KEY}`);

  // Start health monitoring for automatic cleanup
  healthMonitor.startMonitoring();
});
