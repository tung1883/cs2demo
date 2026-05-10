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

export default defineConfig({
  plugins: [demoExportPlugin()],
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
