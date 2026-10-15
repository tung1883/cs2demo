import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import formidable from "formidable";
import { defineConfig, type Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function demoExportPlugin(): Plugin {
  return {
    name: "cs2-demo-export-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? "").split("?")[0] ?? "";
        if (pathname !== "/api/export-dem" || req.method !== "POST") {
          next();
          return;
        }

        void (async () => {
          const form = formidable({ maxFileSize: 1024 * 1024 * 1024 });
          try {
            const [, files] = await form.parse(req);
            const uploaded = files.demo;
            const file =
              uploaded === undefined
                ? undefined
                : Array.isArray(uploaded)
                  ? uploaded[0]
                  : uploaded;

            if (!file || typeof file.filepath !== "string") {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(
                JSON.stringify({
                  error: 'Missing multipart file field "demo"',
                }),
              );
              return;
            }

            const buf = fs.readFileSync(file.filepath);
            try {
              fs.unlinkSync(file.filepath);
            } catch {
              /* temp cleanup */
            }

            res.statusCode = 200;
            res.setHeader(
              "Content-Type",
              "application/x-ndjson; charset=utf-8",
            );
            res.setHeader("Cache-Control", "no-store");

            const writeNdjson = (obj: unknown) => {
              res.write(`${JSON.stringify(obj)}\n`);
            };

            /** Rough ETA for the blocking native `parseTicks` pass (~linear in file size). */
            const estimateTicksMs = Math.min(
              180_000,
              Math.max(
                12_000,
                10_000 + (buf.byteLength * 95) / (1024 * 1024),
              ),
            );

            let workerPct = 6;
            let syntheticPct = 6;
            let lastWorkerLabel = "Starting…";
            let lastEmitPct = -1;
            let lastEmitAt = 0;

            const emitMergedProgress = () => {
              const now = Date.now();
              const pct = Math.min(
                94,
                Math.max(workerPct, syntheticPct),
              );
              if (pct - lastEmitPct < 0.4 && now - lastEmitAt < 450) {
                return;
              }
              lastEmitPct = pct;
              lastEmitAt = now;
              const label =
                workerPct >= syntheticPct
                  ? lastWorkerLabel
                  : `Parsing demo (tick decode)… ~${Math.round(syntheticPct)}% est.`;
              writeNdjson({
                type: "progress",
                phase: "ticks",
                pct,
                label,
              });
            };

            const workerPath = path.resolve(
              __dirname,
              "scripts/demo-export-worker.mjs",
            );

            writeNdjson({
              type: "progress",
              phase: "ticks",
              pct: 4,
              label: "Spawning export worker…",
            });

            await new Promise<void>((resolve) => {
              const started = Date.now();
              let settled = false;

              const finish = () => {
                if (settled) return;
                settled = true;
                clearInterval(iv);
                resolve();
              };

              const iv = setInterval(() => {
                const elapsed = Date.now() - started;
                const t = Math.min(1.25, elapsed / estimateTicksMs);
                syntheticPct = Math.min(36, 8 + t * 28);
                emitMergedProgress();
              }, 280);

              const w = new Worker(workerPath, {
                type: "module",
                workerData: {
                  buffer: buf,
                  demoPathLabel: file.originalFilename ?? "demo.dem",
                  tickStep: Number(process.env.TICK_STEP || 1),
                },
              });

              w.on(
                "message",
                (msg: {
                  type?: string;
                  payload?: unknown;
                  pct?: number;
                  phase?: string;
                  label?: string;
                  error?: string;
                }) => {
                  if (msg.type === "progress") {
                    const p = Number(msg.pct);
                    if (Number.isFinite(p)) workerPct = Math.max(workerPct, p);
                    if (typeof msg.label === "string") lastWorkerLabel = msg.label;
                    emitMergedProgress();
                    return;
                  }
                  if (msg.type === "done") {
                    writeNdjson({
                      type: "progress",
                      phase: "finalize",
                      pct: 99,
                      label: "Finishing…",
                    });
                    writeNdjson({ type: "done", payload: msg.payload });
                    finish();
                    return;
                  }
                  if (msg.type === "error") {
                    writeNdjson({
                      type: "error",
                      error:
                        typeof msg.error === "string"
                          ? msg.error
                          : "Export failed.",
                    });
                    finish();
                  }
                },
              );

              w.on("error", (err) => {
                writeNdjson({
                  type: "error",
                  error: err.message || String(err),
                });
                finish();
              });

              w.on("exit", (code) => {
                if (!settled && code !== 0) {
                  writeNdjson({
                    type: "error",
                    error: `Export worker exited with code ${code}`,
                  });
                  finish();
                }
              });
            });

            res.end();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: msg }));
          }
        })();
      });
    },
  };
}

/**
 * Dev-only `/steam-avatar?steamid=<id64>` proxy: reads the public Steam profile XML, fetches the
 * full-size avatar and returns the image bytes (browsers can't call steamcommunity.com directly
 * because of CORS). Results are cached in memory; any failure is a 404 so the viewer falls back
 * to its coloured dots.
 */
function steamAvatarPlugin(): Plugin {
  const cache = new Map<string, { type: string; body: Buffer } | null>();
  const timeoutFetch = async (url: string): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    name: "cs2-steam-avatar",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [pathname, query = ""] = (req.url ?? "").split("?");
        if (pathname !== "/steam-avatar") {
          next();
          return;
        }
        const steamid = new URLSearchParams(query).get("steamid") ?? "";
        if (!/^\d{17}$/.test(steamid)) {
          res.statusCode = 400;
          res.end("bad steamid");
          return;
        }
        void (async () => {
          try {
            let hit = cache.get(steamid);
            if (hit === undefined) {
              hit = null;
              const xml = await (await timeoutFetch(`https://steamcommunity.com/profiles/${steamid}?xml=1`)).text();
              const m = /<avatarFull><!\[CDATA\[(https:\/\/[^\]]+)\]\]><\/avatarFull>/.exec(xml);
              if (m) {
                const img = await timeoutFetch(m[1]);
                const type = img.headers.get("content-type") ?? "";
                if (img.ok && type.startsWith("image/")) {
                  hit = { type, body: Buffer.from(await img.arrayBuffer()) };
                }
              }
              cache.set(steamid, hit);
            }
            if (!hit) {
              res.statusCode = 404;
              res.end("no avatar");
              return;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", hit.type);
            res.setHeader("Cache-Control", "public, max-age=86400");
            res.end(hit.body);
          } catch {
            res.statusCode = 404;
            res.end("avatar fetch failed");
          }
        })();
      });
    },
  };
}

export default defineConfig({
  plugins: [demoExportPlugin(), steamAvatarPlugin()],
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
