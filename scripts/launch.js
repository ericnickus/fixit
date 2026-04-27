import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

const BASE_BACKEND_PORT = Number(process.env.BASE_BACKEND_PORT || 8787);
const BASE_FRONTEND_PORT = Number(process.env.BASE_FRONTEND_PORT || 5173);

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateExistingStack() {
  const projectRoot = process.cwd();
  const pattern = `${escapeRegex(projectRoot)}/(scripts/launch.js|server/server.js|node_modules/.bin/vite)`;
  const result = spawnSync("pgrep", ["-f", pattern], {
    encoding: "utf8"
  });

  const pids = String(result.stdout || "")
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid);

  if (pids.length === 0) {
    return;
  }

  console.log(`[launch] Cleaning stale Fixityerself processes: ${pids.join(", ")}`);

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have already exited.
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 500));

  for (const pid of pids) {
    if (!processExists(pid)) {
      continue;
    }

    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process may exit between checks.
    }
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    // Match Express/Node default binding behavior so occupied IPv6 listeners are detected.
    server.listen(port);
  });
}

async function findAvailablePort(startPort, reserved = new Set()) {
  let port = startPort;

  while (port < 65535) {
    if (reserved.has(port)) {
      port += 1;
      continue;
    }

    const free = await isPortFree(port);
    if (free) {
      return port;
    }

    port += 1;
  }

  throw new Error(`No available port found starting at ${startPort}`);
}

function streamWithPrefix(child, prefix) {
  if (child.stdout) {
    child.stdout.on("data", (chunk) => {
      process.stdout.write(`${prefix}${chunk}`);
    });
  }

  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      process.stderr.write(`${prefix}${chunk}`);
    });
  }
}

async function launch() {
  await terminateExistingStack();

  const reserved = new Set();
  const backendPort = await findAvailablePort(BASE_BACKEND_PORT, reserved);
  reserved.add(backendPort);
  const frontendPort = await findAvailablePort(BASE_FRONTEND_PORT, reserved);

  let appUrl = `http://localhost:${frontendPort}/`;
  const apiUrl = `http://localhost:${backendPort}`;

  console.log(`[launch] Backend port selected: ${backendPort}`);
  console.log(`[launch] Frontend port selected: ${frontendPort}`);

  const backend = spawn("npm", ["run", "dev:server"], {
    env: {
      ...process.env,
      PORT: String(backendPort)
    },
    stdio: ["inherit", "pipe", "pipe"]
  });

  const frontend = spawn("npm", ["run", "dev:client"], {
    env: {
      ...process.env,
      VITE_PORT: String(frontendPort),
      API_PORT: String(backendPort)
    },
    stdio: ["inherit", "pipe", "pipe"]
  });

  streamWithPrefix(backend, "[server] ");
  streamWithPrefix(frontend, "[client] ");

  let browserOpened = false;
  if (frontend.stdout) {
    frontend.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      if (browserOpened) {
        return;
      }

      if (text.includes("Local:")) {
        const detectedUrl = text.match(/https?:\/\/localhost:\d+\/?/);
        if (detectedUrl) {
          appUrl = detectedUrl[0];
        }
        browserOpened = true;
        console.log(`[launch] Opening ${appUrl}`);
        const opener = spawn("open", [appUrl], {
          detached: true,
          stdio: "ignore"
        });
        opener.unref();
      }
    });
  }

  console.log("[launch] Expected result: browser opens the detected local frontend URL with the Fixityerself intake screen.");
  console.log(`[launch] API endpoint: ${apiUrl}`);
  console.log("[launch] Press Ctrl+C to stop services and release ports.");

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[launch] Received ${signal}. Shutting down services...`);

    if (!backend.killed) {
      backend.kill("SIGTERM");
    }
    if (!frontend.killed) {
      frontend.kill("SIGTERM");
    }

    setTimeout(() => {
      if (!backend.killed) {
        backend.kill("SIGKILL");
      }
      if (!frontend.killed) {
        frontend.kill("SIGKILL");
      }
      process.exit(0);
    }, 1200);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  backend.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[launch] Backend exited unexpectedly with code ${code ?? "unknown"}.`);
      shutdown("BACKEND_EXIT");
    }
  });

  frontend.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[launch] Frontend exited unexpectedly with code ${code ?? "unknown"}.`);
      shutdown("FRONTEND_EXIT");
    }
  });
}

launch().catch((error) => {
  console.error("[launch] Failed to start services:", error.message);
  process.exit(1);
});
