import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "pg";
const { Pool } = pkg;

import { createSelfMemoryStore } from "./modules/selfMemory.js";
import { createStepMetricsStore } from "./modules/stepMetrics.js";
import { getRuntimeConfigPath, loadRuntimeConfig, resolveActiveModeConfig } from "./modules/runtimeConfig.js";
import { createRequestThrottle } from "./modules/requestThrottle.js";
import { createConformStatsStore } from "./modules/conformStats.js";
import { createRequestHistoryLogger } from "./modules/requestHistoryLogger.js";
import { processRepairPlanRequest } from "./ai-processing/repairPlanProcessor.js";

dotenv.config();

const app = express();

// Set up __dirname equivalent for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = Number(process.env.PORT || 8787);
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const runtimeConfig = loadRuntimeConfig();
const { mode, modeOptions, modeConfig } = resolveActiveModeConfig(runtimeConfig);
const requiredModelByMode = {
  SubagentMode: "gpt-4.1-mini",
  UserMode: "gpt-5-mini"
};
const activeModel = modeConfig?.lowCostModel || requiredModelByMode[mode] || "gpt-5-mini";
const plannerPath = modeConfig?.plannerPath || "agent-run-subagent";
const configuredLowCostModel = modeConfig?.lowCostModel || activeModel;
const lowCostModel = mode === "UserMode" ? requiredModelByMode.UserMode : configuredLowCostModel;

const runModeSettings = {
  promptCooldownSeconds: Number(runtimeConfig.runModeSettings?.promptCooldownSeconds || 20),
  safetyBlockingEnabled: runtimeConfig.runModeSettings?.safetyBlockingEnabled !== false,
  normalizeCodeToText: runtimeConfig.runModeSettings?.normalizeCodeToText !== false,
  keepUserHistory: runtimeConfig.runModeSettings?.keepUserHistory === true,
  historyLogFile: String(runtimeConfig.runModeSettings?.historyLogFile || "data/requestHistory.jsonl").trim(),
  plannerTimeoutMs: Math.max(10000, Number(runtimeConfig.runModeSettings?.plannerTimeoutMs || 30000)),
  searchVerifierTimeoutMs: Math.max(3000, Number(runtimeConfig.runModeSettings?.searchVerifierTimeoutMs || 8000))
};

const promptThrottle = createRequestThrottle({ cooldownSeconds: runModeSettings.promptCooldownSeconds });

// Database Connection Pool
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});

const API_KEY_CANDIDATES = [
  "OPENAI_API_KEY",
  "CHATGPT_API_KEY",
  "OPENAI_KEY",
  "NAI_API_KEY",
  "GPT_API_KEY"
];

function buildApiKeyCandidateList(config) {
  const configuredName = typeof config?.runModeSettings?.apiKeyEnvVar === "string"
    ? config.runModeSettings.apiKeyEnvVar.trim()
    : "";

  const discoveredNames = Object.keys(process.env).filter((name) => {
    const hasProviderHint = /(OPEN.?AI|CHAT.?GPT|GPT|NAI)/i.test(name) && /(KEY|TOKEN)/i.test(name);
    return hasProviderHint;
  });

  return [...new Set([
    ...(configuredName ? [configuredName] : []),
    ...API_KEY_CANDIDATES,
    ...Object.keys(process.env).filter((name) => /(OPEN.?AI|CHAT.?GPT|GPT|NAI)/i.test(name) && /(KEY|TOKEN)/i.test(name))
  ])];
}

function resolveApiKey(candidateList) {
  for (const keyName of candidateList) {
    const value = process.env[keyName];
    if (typeof value === "string" && value.trim().length > 0) {
      return {
        keyName,
        apiKey: value.trim()
      };
    }
  }
  return { keyName: null, apiKey: "" };
}

const apiKeyCandidateList = buildApiKeyCandidateList(runtimeConfig);
const apiKeyResolution = resolveApiKey(apiKeyCandidateList);

const openai = apiKeyResolution.apiKey
  ? new OpenAI({ apiKey: apiKeyResolution.apiKey })
  : null;

const memoryStore = createSelfMemoryStore();
const metricsStore = createStepMetricsStore();
const conformStatsStore = createConformStatsStore();
const requestHistoryLogger = createRequestHistoryLogger({
  enabled: runModeSettings.keepUserHistory,
  filePath: runModeSettings.historyLogFile || "data/requestHistory.jsonl"
});

await Promise.all([memoryStore.load(), metricsStore.load(), conformStatsStore.load()]);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Serve static files from the parent directory (/var/www/fixit/ relative to /server/)
app.use(express.static(path.join(__dirname, '../dist')));

// Zod Schema
const StepEventSchema = z.object({
  sessionId: z.string().min(1),
  issueFingerprint: z.string().optional().default(""),
  stepId: z.string().min(1),
  stepTitle: z.string().min(1),
  stepIndex: z.number().int().min(0),
  outcome: z.enum(["done", "failed"]),
  timestamp: z.string().optional().default("")
});

// --- Authentication & Payment Endpoints ---

app.get("/api/auth/status", async (request, response) => {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return response.json({ authenticated: false });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userQuery = await pool.query("SELECT user_has_paid FROM users WHERE id = $1", [decoded.userId]);

    if (userQuery.rows.length === 0) {
      return response.json({ authenticated: false });
    }

    return response.json({
      authenticated: true,
      hasPaid: userQuery.rows[0].user_has_paid
    });
  } catch (err) {
    return response.json({ authenticated: false });
  }
});

app.post("/api/auth/login", async (request, response) => {
  const { email, password } = request.body;

  try {
    const userQuery = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userQuery.rows.length === 0) {
      return response.status(401).json({ message: "Invalid credentials" });
    }

    const user = userQuery.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (passwordMatch) {
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "24h" });
      return response.json({
        token,
        hasPaid: user.user_has_paid
      });
    }

    return response.status(401).json({ message: "Invalid credentials" });
  } catch (err) {
    console.error("Login Error:", err);
    return response.status(500).json({ message: "Internal Server Error" });
  }
});

app.post("/api/auth/signup", async (request, response) => {
  const { email, password } = request.body;

  try {
    const existingUser = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (existingUser.rows.length > 0) {
      return response.status(400).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const insertQuery = `
      INSERT INTO users (email, password_hash, user_has_paid) 
      VALUES ($1, $2, false) 
      RETURNING id, user_has_paid
    `;
    const newUser = await pool.query(insertQuery, [email, hashedPassword]);

    const token = jwt.sign({ userId: newUser.rows[0].id }, process.env.JWT_SECRET, { expiresIn: "24h" });

    return response.json({
      token,
      hasPaid: newUser.rows[0].user_has_paid
    });
  } catch (err) {
    console.error("Signup Error:", err);
    return response.status(500).json({ message: "Internal Server Error" });
  }
});

app.post("/api/payment/charge", async (request, response) => {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return response.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const updateQuery = `
      UPDATE users 
      SET user_has_paid = true 
      WHERE id = $1 
      RETURNING id, user_has_paid
    `;
    
    const result = await pool.query(updateQuery, [decoded.userId]);

    if (result.rows.length === 0) {
      return response.status(404).json({ message: "User not found" });
    }

    return response.json({
      success: true,
      hasPaid: result.rows[0].user_has_paid,
      message: "Payment simulation successful. Status updated."
    });

  } catch (err) {
    console.error("Payment Error:", err);
    return response.status(401).json({ message: "Invalid or expired token" });
  }
});

// --- API Routes ---

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    mode,
    modeOptions,
    model,
    usingOpenAI: Boolean(openai),
    plannerPath,
    lowCostModel,
    configuredLowCostModel,
    requiredModelByMode,
    runModeSettings,
    apiKeyConfiguredFrom: apiKeyResolution.keyName,
    apiKeyCandidateList,
    runtimeConfigPath: getRuntimeConfigPath()
  });
});

app.post("/api/repair-plan", async (request, response) => {
  const result = await processRepairPlanRequest({
    body: request.body,
    requestIp: request.ip,
    openaiClient: openai,
    runModeSettings,
    modeConfig,
    lowCostModel,
    plannerPath,
    mode,
    promptThrottle,
    memoryStore,
    metricsStore,
    conformStatsStore,
    requestHistoryLogger,
    apiKeyCandidateList
  });

  if (result.headers) {
    for (const [header, value] of Object.entries(result.headers)) {
      response.set(header, value);
    }
  }

  return response.status(result.status).json(result.body);
});


app.post("/api/step-event", async (request, response) => {
  const parsed = StepEventSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      error: "Invalid step event payload",
      details: parsed.error.flatten()
    });
  }

  const event = parsed.data;
  const snapshot = metricsStore.record(event);

  response.json({
    ok: true,
    viabilitySnapshot: snapshot
  });
});

app.get("/api/metrics", (_request, response) => {
  response.json({
    ...metricsStore.summary(),
    conformStats: conformStatsStore.summary()
  });
});

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Welcome to the Fixityerself API!',
    timestamp: new Date()
  });
});

// Fallback to serve your index.html file for non-API, front-end routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../index.html'));
});

// Start Server
app.listen(port, () => {
  console.log(`Fixityerself backend listening on port ${port}`);
});
