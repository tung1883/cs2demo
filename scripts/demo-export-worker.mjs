/**
 * Runs demo export off the dev-server thread so the parent can emit synthetic
 * progress while `parseTicks` blocks this worker.
 */
import { parentPort, workerData } from "node:worker_threads";
import { exportDemoBuffer } from "./demo-buffer-to-json.mjs";

const raw = workerData.buffer;
const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

try {
  const payload = await exportDemoBuffer(buffer, {
    demoPathLabel: workerData.demoPathLabel ?? "demo.dem",
    tickStep: Number(workerData.tickStep ?? 1),
    onProgress: (ev) => {
      parentPort?.postMessage({ type: "progress", ...ev });
    },
  });
  parentPort?.postMessage({ type: "done", payload });
} catch (e) {
  parentPort?.postMessage({
    type: "error",
    error: e instanceof Error ? e.message : String(e),
  });
}
