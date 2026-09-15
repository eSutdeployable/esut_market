import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerApiFallback } from "./apiFallback";
import { serveStatic, setupVite } from "./vite";
import { registerProductReminderSchedule } from "../productReminderSchedule";
import { registerReservationExpirySchedule } from "../reservationExpirySchedule";
import { applySecurityHeaders } from "./securityHeaders";
import { ENV } from "./env";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    applySecurityHeaders(req, res);
    next();
  });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  const allowedOrigins = [
    "https://esutmarketplace.com",
    "https://www.esutmarketplace.com",
  ];
  if (process.env.NODE_ENV === "development") {
    allowedOrigins.push("http://localhost:5173", "http://localhost:3000");
  }
  if (ENV.frontendUrl && !allowedOrigins.includes(ENV.frontendUrl)) {
    allowedOrigins.push(ENV.frontendUrl);
  }
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true, service: "esut-marketplace" });
  });
  registerStorageProxy(app);
  // OAuth redirects and session-setting responses must not be cached.
  app.use("/api/oauth", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  registerOAuthRoutes(app);
  // Authenticated RPC responses must not be cached by browsers or shared proxies.
  app.use("/api/trpc", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  registerProductReminderSchedule(app);
  registerReservationExpirySchedule(app);
  // API routes must never fall through to the SPA HTML response, otherwise clients
  // attempting to parse an API payload receive an opaque `Unexpected token '<'` error.
  registerApiFallback(app);
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
