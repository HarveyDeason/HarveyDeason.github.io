// scripts/time-pid-worker-shim.mjs
// Runs the REAL assets/js/pid-symbol-check-worker.js inside a Node worker thread,
// so scripts/time-pid-pipeline.mjs can time the same message-passing the browser
// does (structured clone in, progress messages, structured clone out).
//
// The browser worker talks through `self.onmessage` / `self.postMessage`; Node has
// neither, so this gives it both, on top of worker_threads. Nothing else is changed.
import { parentPort, workerData } from 'node:worker_threads';

globalThis.self = { onmessage: null, postMessage: m => parentPort.postMessage(m) };
await import(workerData.workerUrl);
parentPort.on('message', data => {
  if (typeof self.onmessage === 'function') self.onmessage({ data });
});
parentPort.postMessage({ type: 'ready' });
