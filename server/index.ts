import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { handleAiChatRequest } from "./ai";
import { handleGetSaved, handleLogin, handleLogout, handleMe, handleRegister, handleRequestCode, handleSetSaved } from "./auth";
import { handleOpenAlexResearchersRequest } from "./openalex";
import { handleRankingHealthRequest, handleRankingRankRequest } from "./ranking";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "1mb" }));

  app.post("/api/ai/chat", async (req, res) => {
    await handleAiChatRequest(req.body, res);
  });

  app.post("/api/auth/request-code", (req, res) => {
    handleRequestCode(req.body, res);
  });

  app.post("/api/auth/register", (req, res) => {
    handleRegister(req.body, res);
  });

  app.post("/api/auth/login", (req, res) => {
    handleLogin(req.body, res);
  });

  app.post("/api/auth/logout", (req, res) => {
    handleLogout(req, res);
  });

  app.get("/api/auth/me", (req, res) => {
    handleMe(req, res);
  });

  app.get("/api/saved-researchers", (req, res) => {
    handleGetSaved(req, res);
  });

  app.put("/api/saved-researchers", (req, res) => {
    handleSetSaved(req, req.body, res);
  });

  app.get("/api/openalex/researchers", async (req, res) => {
    await handleOpenAlexResearchersRequest(req, res);
  });

  app.get("/api/ranking/health", async (_req, res) => {
    await handleRankingHealthRequest({}, res);
  });

  app.post("/api/ranking/rank", async (req, res) => {
    await handleRankingRankRequest(req.body, res);
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "research-ai" });
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
