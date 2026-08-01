import { validateSessionEnvelope, type SessionEnvelope } from "./sessionFormat";

export function downloadSessionEnvelope(envelope: SessionEnvelope, fileNameBase: string): void {
  const blob = new Blob([JSON.stringify(envelope)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileNameBase}.cs2viewer-session.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importSessionFile(file: File): Promise<SessionEnvelope> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON.");
  }
  if (!validateSessionEnvelope(parsed)) {
    throw new Error("Not a recognized session file (expected a cs2-2d-demo-viewer-session export).");
  }
  return parsed;
}
