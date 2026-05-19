import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pg from "pg";

const { Pool } = pg;

import { createSelfMemoryStore } from "./modules/selfMemory.js";
import { createStepMetricsStore } from "./modules/stepMetrics.js";
import { getRuntimeConfigPath, loadRuntimeConfig, resolveActiveModeConfig } from "./modules/runtimeConfig.js";
import { createRequestThrottle } from "./modules/requestThrottle.js";
import { createConformStatsStore } from "./modules/conformStats.js";
import { createRequestHistoryLogger } from "./modules/requestHistoryLogger.js";
import { processRepairPlanRequest } from "./ai-processing/repairPlanProcessor.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);

// =====================
// ENV SAFETY (IMPORTANT)
// =====================
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required");
}

// =====================
// DATABASE POOL
// =====================
const pool = new Pool({
  user: process.env.DB_USER || "app_admin",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "my_guardian_app",
  password: String(process.env.DB_PASSWORD || ""),
  port: Number(process.env.DB_PORT || 5432),
});

// =====================
// MIDDLEWARE
// =====================
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// =====================
// AUTH HELPER (TIMEOUT SAFE)
// =====================
const withTimeout = (promise, ms = 4000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("DB_TIMEOUT")), ms)
    ),
  ]);
};

// =====================
// AUTH STATUS
// =====================
app.get("/api/auth/status", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.json({ authenticated: false });
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.json({ authenticated: false });
    }

    const userQuery = await withTimeout(
      pool.query(
        "SELECT email, user_has_paid FROM users WHERE id = $1",
        [decoded.userId]
      )
    );

    if (userQuery.rows.length === 0) {
      return res.json({ authenticated: false });
    }

    return res.json({
      authenticated: true,
      email: userQuery.rows[0].email,
      hasPaid: userQuery.rows[0].user_has_paid,
    });
  } catch (err) {
    console.error("AUTH ERROR:", err.message);
    return res.json({ authenticated: false });
  }
});

// =====================
// LOGIN
// =====================
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const userQuery = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (!userQuery.rows.length) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = userQuery.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    return res.json({
      token,
      hasPaid: user.user_has_paid,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

// =====================
// SIGNUP
// =====================
app.post("/api/auth/signup", async (req, res) => {
  const { email, password } = req.body;

  try {
    const existing = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, user_has_paid)
       VALUES ($1, $2, false)
       RETURNING id, user_has_paid`,
      [email, hash]
    );

    const token = jwt.sign(
      { userId: result.rows[0].id },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    return res.json({
      token,
      hasPaid: false,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

// =====================
// PAYMENT
// =====================
app.post("/api/payment/charge", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      `UPDATE users SET user_has_paid = true
       WHERE id = $1
       RETURNING id, user_has_paid`,
      [decoded.userId]
    );

    return res.json({
      success: true,
      hasPaid: result.rows[0]?.user_has_paid || false,
    });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ message: "Invalid token" });
  }
});

// =====================
// HEALTH
// =====================
app.get("/api/health", (_, res) => {
  res.json({ ok: true });
});

// =====================
// START SERVER
// =====================
app.listen(port, () => {
  console.log(`Backend running on ${port}`);
});
