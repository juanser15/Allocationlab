import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

const publicPort = Number(process.env.PORT || 10000);
const apiPort = 3001;
const root = path.resolve("artifacts/allocation-lab/dist/public");
const indexFile = path.join(root, "index.html");
const openPreview = process.env.WORKBENCH_PREVIEW_OPEN === "1";
const liveSmoke = process.env.WORKBENCH_P0_LIVE_SMOKE === "1";
const sessionTokenKey = "allocationlab.workbench.preview-token";
const injectedSessionToken = "render-open-preview";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const api = spawn(
  process.execPath,
  ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"],
  { stdio: "inherit", env: { ...process.env, PORT: String(apiPort), RENDER_LOCAL_API: "1" } },
);

function localApi(pathname, method = "GET", body) {
  const token = process.env.WORKBENCH_PREVIEW_TOKEN;
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
    };
    const request = http.request(
      { hostname: "127.0.0.1", port: apiPort, path: pathname, method, headers },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
          if (data.length > 8192) data = data.slice(0, 8192);
        });
        response.on("end", () => resolve({ status: response.statusCode || 0, body: data }));
      },
    );
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function runLiveSmoke() {
  if (!liveSmoke) return;
  let workspace = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      workspace = await localApi("/api/workbench/library/workspace");
      if (workspace.status !== 502 && workspace.status !== 503) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log(
    "P0_LIVE_SMOKE_POSTGRES",
    JSON.stringify({
      status: workspace?.status ?? 0,
      ok: workspace?.status === 200,
      body: String(workspace?.body ?? "").slice(0, 1000),
    }),
  );

  try {
    const yahoo = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/SPY?period1=1735776000&period2=1736553600&interval=1d&events=div%2Csplits&includeAdjustedClose=true",
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "AllocationLab/1.0 live-smoke",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    const text = await yahoo.text();
    let observations = null;
    try {
      const body = JSON.parse(text);
      observations = body?.chart?.result?.[0]?.timestamp?.length ?? 0;
    } catch {}
    console.log(
      "P0_LIVE_SMOKE_YAHOO",
      JSON.stringify({
        status: yahoo.status,
        ok: yahoo.ok,
        observations,
      }),
    );
  } catch (error) {
    console.log(
      "P0_LIVE_SMOKE_YAHOO",
      JSON.stringify({
        status: 0,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

if (liveSmoke) {
  setTimeout(() => void runLiveSmoke(), 2500);
}

function sendFile(file, response) {
  response.setHeader("Content-Type", mime[path.extname(file).toLowerCase()] || "application/octet-stream");
  if (path.basename(file) === "index.html") {
    response.setHeader("Cache-Control", "no-store");
    if (openPreview) {
      fs.readFile(file, "utf8", (error, html) => {
        if (error) {
          response.writeHead(500);
          response.end("Unable to read asset");
          return;
        }
        const injection = `<script>sessionStorage.setItem(${JSON.stringify(sessionTokenKey)},${JSON.stringify(injectedSessionToken)});</script><style>.workbench-header>button{display:none!important}</style>`;
        response.end(html.includes("</head>") ? html.replace("</head>", `${injection}</head>`) : `${injection}${html}`);
      });
      return;
    }
  }
  const stream = fs.createReadStream(file);
  stream.on("error", () => {
    if (!response.headersSent) response.writeHead(500);
    response.end("Unable to read asset");
  });
  stream.pipe(response);
}

const server = http.createServer((request, response) => {
  let parsed;
  try {
    parsed = new URL(request.url || "/", "http://localhost");
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  if (parsed.pathname === "/") {
    response.writeHead(302, { Location: "/workbench" });
    response.end();
    return;
  }

  if (parsed.pathname === "/api" || parsed.pathname.startsWith("/api/")) {
    const headers = { ...request.headers };
    if (openPreview && parsed.pathname.startsWith("/api/workbench")) {
      const token = process.env.WORKBENCH_PREVIEW_TOKEN;
      if (token) headers.authorization = `Bearer ${token}`;
    }
    const proxy = http.request(
      {
        hostname: "127.0.0.1",
        port: apiPort,
        path: request.url,
        method: request.method,
        headers,
      },
      (upstream) => {
        response.writeHead(upstream.statusCode || 502, upstream.headers);
        upstream.pipe(response);
      },
    );
    proxy.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Research API is starting or unavailable" }));
    });
    request.pipe(proxy);
    return;
  }

  let requested;
  try {
    requested = path.resolve(root, "." + decodeURIComponent(parsed.pathname));
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  if (!(requested === root || requested.startsWith(root + path.sep))) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.stat(requested, (error, stat) => {
    sendFile(!error && stat.isFile() ? requested : indexFile, response);
  });
});

server.listen(publicPort, "0.0.0.0", () => {
  console.log(`Allocation Lab Render preview on ${publicPort}; API on localhost:${apiPort}; openPreview=${openPreview}`);
});

function shutdown() {
  api.kill("SIGTERM");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
api.on("exit", (code, signal) => {
  if (code !== 0 && signal !== "SIGTERM") process.exit(code || 1);
});
