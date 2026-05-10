import init, {
  parseHeader,
  parseTicks,
  parseEvents,
} from "@laihoe/demoparser2/wasm/pkg/demoparser2.js";
import wasmUrl from "@laihoe/demoparser2/wasm/pkg/demoparser2_bg.wasm?url";
import { buildDemoData } from "../demo-export/buildDemoData";

/** WASM pkg metadata reports 0.1.0 while native NAPI is newer — kept alongside upstream for browser parity. */

let wasmReady: Promise<void> | null = null;

function ensureWasm(): Promise<void> {
  wasmReady ??= init(wasmUrl).then(() => {});
  return wasmReady;
}

export type WasmWorkerInbound =
  | {
      type: "export";
      buffer: ArrayBuffer;
      demoPathLabel: string;
      tickStep: number;
    };

self.addEventListener("message", (ev: MessageEvent<WasmWorkerInbound>) => {
  const msg = ev.data;
  if (msg.type !== "export") return;

  void (async () => {
    try {
      await ensureWasm();
      const uint8 = new Uint8Array(msg.buffer);
      const payload = await buildDemoData(uint8, {
        parseHeader,
        parseTicks: (f, props, ticks, soa) =>
          parseTicks(
            f,
            props ?? undefined,
            ticks ?? undefined,
            soa ?? undefined,
          ),
        parseEvents,
      }, {
        demoPathLabel: msg.demoPathLabel,
        tickStep: msg.tickStep,
        onProgress: (e) => {
          self.postMessage({ type: "progress", ...e });
        },
      });
      self.postMessage({ type: "done", payload });
    } catch (err) {
      self.postMessage({
        type: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
});
