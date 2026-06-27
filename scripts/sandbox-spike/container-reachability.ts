// @effect-diagnostics nodeBuiltinImport:off - spike talks to the Docker Engine
// API over the Unix socket via Node built-ins; no Docker client npm dependency.
// @effect-diagnostics globalDate:off - standalone script, no Effect runtime.
// @effect-diagnostics globalFetch:off - standalone script, no Effect HttpClient.
// @effect-diagnostics globalTimers:off - standalone script, no Effect Schedule.
// @effect-diagnostics globalConsole:off - standalone script, prints findings.
import * as http from "node:http";

/**
 * Container feasibility spike (AC-1.7).
 *
 * Proves a local Docker/OrbStack container can host a long-lived server process,
 * publish a port to `localhost`, and sustain a `ws` connection from the host —
 * the reachability model Phase 1's container driver depends on. Runs live if a
 * Docker daemon is reachable on `/var/run/docker.sock` (or `$DOCKER_HOST`);
 * typechecks under `vp run typecheck` regardless.
 *
 * Transport: raw Docker Engine HTTP API over the Unix socket via Node built-ins
 * — no `dockerode`. The in-container server also uses only Node built-ins (a
 * hand-rolled RFC 6455 WebSocket echo) so the spike pulls no npm packages into
 * the image. Findings are printed and recorded in the Phase 1 spec's Spike
 * findings section.
 */

const DOCKER_HOST = process.env.DOCKER_HOST ?? "/var/run/docker.sock";
const IMAGE = process.env.SANDBOX_SPIKE_IMAGE ?? "node:22-alpine";
const CONTAINER_PORT = 3000;

// In-container server: HTTP 200 on /healthz + a hand-rolled WebSocket echo on
// /ws (RFC 6455 handshake + single text-frame echo). Only Node built-ins, so
// the image needs no `ws` npm package.
const SERVER_SCRIPT = [
  "cat > /tmp/srv.mjs <<'EOF'",
  "import { createServer } from 'node:http';",
  "import { createHash } from 'node:crypto';",
  "const server = createServer((req, res) => {",
  "  if (req.url === '/healthz') { res.writeHead(200); res.end('ok'); return; }",
  "  res.writeHead(404); res.end();",
  "});",
  "server.on('upgrade', (req, socket) => {",
  "  if (req.url !== '/ws') { socket.destroy(); return; }",
  "  const key = req.headers['sec-websocket-key'];",
  "  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');",
  "  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n');",
  "  socket.on('data', (buf) => {",
  "    const opcode = buf[0] & 0x0f;",
  "    const masked = (buf[1] & 0x80) === 0x80;",
  "    let len = buf[1] & 0x7f; let offset = 2;",
  "    if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }",
  "    let mask = Buffer.alloc(0);",
  "    if (masked) { mask = buf.subarray(offset, offset + 4); offset += 4; }",
  "    const payload = buf.subarray(offset, offset + len);",
  "    if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];",
  "    if (opcode === 0x8) { socket.end(); return; }",
  "    const text = payload.toString('utf8');",
  "    const reply = Buffer.alloc(2 + text.length);",
  "    reply[0] = 0x81; reply[1] = text.length; reply.write(text, 2, 'utf8');",
  "    socket.write(reply);",
  "  });",
  "});",
  `server.listen(${CONTAINER_PORT}, () => process.stdout.write('LISTENING ${CONTAINER_PORT}\\n'));`,
  "EOF",
  "node /tmp/srv.mjs",
].join("\n");

interface SpikeResult {
  provision: "pass" | "fail";
  portPublish: "pass" | "fail";
  ws: "pass" | "fail";
  longLivedProcess: "pass" | "fail";
  api: string;
  note?: string;
}

function dockerRequest(
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: DOCKER_HOST,
        path,
        method: init.method ?? "GET",
        headers: init.body
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(init.body) }
          : {},
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

async function runSpike(): Promise<SpikeResult> {
  const result: SpikeResult = {
    provision: "fail",
    portPublish: "fail",
    ws: "fail",
    longLivedProcess: "fail",
    api: "Docker Engine REST API over Unix socket (/var/run/docker.sock or $DOCKER_HOST)",
  };

  let ping: { status: number; body: string };
  try {
    ping = await dockerRequest("/_ping");
  } catch (e) {
    result.note = `blocked: needs local Docker (${(e as Error).message})`;
    return result;
  }
  if (ping.status !== 200) {
    result.note = `blocked: Docker _ping returned ${ping.status}`;
    return result;
  }

  const name = `kata-sandbox-spike-${Date.now()}`;
  // Ensure the image is present (pull if missing). The spike is self-sufficient:
  // no manual `docker pull` prerequisite.
  try {
    const img = await dockerRequest(`/images/${encodeURIComponent(IMAGE)}/json`);
    if (img.status === 404) {
      await dockerRequest(`/images/create?fromImage=${encodeURIComponent(IMAGE)}`, {
        method: "POST",
      });
    }
  } catch (e) {
    result.note = `image pull error: ${(e as Error).message}`;
    return result;
  }
  const createBody = JSON.stringify({
    Image: IMAGE,
    Cmd: ["sh", "-c", SERVER_SCRIPT],
    HostConfig: {
      PortBindings: { [`${CONTAINER_PORT}/tcp`]: [{ HostPort: "0" }] },
      AutoRemove: true,
    },
    ExposedPorts: { [`${CONTAINER_PORT}/tcp`]: {} },
    Labels: { "kata.sandbox-spike": "true" },
  });
  let containerId: string;
  try {
    const created = await dockerRequest(`/containers/create?name=${name}`, {
      method: "POST",
      body: createBody,
    });
    if (created.status >= 300) {
      result.note = `create failed: ${created.status} ${created.body.slice(0, 200)}`;
      return result;
    }
    containerId = JSON.parse(created.body).Id;
    await dockerRequest(`/containers/${containerId}/start`, { method: "POST" });
    result.provision = "pass";
  } catch (e) {
    result.note = `provision error: ${(e as Error).message}`;
    return result;
  }

  try {
    const inspect = await dockerRequest(`/containers/${containerId}/json`);
    const info = JSON.parse(inspect.body);
    const binding = info.NetworkSettings.Ports[`${CONTAINER_PORT}/tcp`]?.[0];
    const hostPort = binding?.HostPort;
    if (!hostPort) {
      result.note = "no published host port";
      return result;
    }
    result.portPublish = "pass";

    const healthUrl = `http://localhost:${hostPort}/healthz`;
    let healthy = false;
    for (let i = 0; i < 40; i++) {
      try {
        const hres = await fetch(healthUrl);
        if (hres.status === 200) {
          healthy = true;
          break;
        }
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (healthy) result.longLivedProcess = "pass";
    else {
      result.note = "healthz never returned 200";
      return result;
    }

    const wsUrl = `ws://localhost:${hostPort}/ws`;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("ws timeout"));
      }, 5000);
      ws.addEventListener("open", () => ws.send("hello-spike"));
      ws.addEventListener("message", (ev) => {
        if (ev.data === "hello-spike") {
          clearTimeout(timeout);
          ws.close();
          result.ws = "pass";
          resolve();
        }
      });
      ws.addEventListener("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  } finally {
    try {
      await dockerRequest(`/containers/${containerId}?force=true`, { method: "DELETE" });
    } catch {
      // best-effort; AutoRemove is on
    }
  }

  return result;
}

const main = async (): Promise<void> => {
  const r = await runSpike();
  const allPass =
    r.provision === "pass" &&
    r.portPublish === "pass" &&
    r.ws === "pass" &&
    r.longLivedProcess === "pass";
  console.log("=== container-reachability spike ===");
  console.log(JSON.stringify(r, null, 2));
  console.log(allPass ? "SPIKE: PASS" : r.note ? `SPIKE: BLOCKED (${r.note})` : "SPIKE: FAIL");
  if (r.note?.startsWith("blocked:")) process.exit(0);
  process.exit(allPass ? 0 : 1);
};

void main();
