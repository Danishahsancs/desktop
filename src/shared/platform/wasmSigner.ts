// in-renderer port of electron/crypto.ts for platforms without an electron main
// process (capacitor). same wasm module and exports, but uses web apis instead
// of node's Buffer / crypto. loaded lazily so desktop bundles never pull it in.
import { SIGNER_WASM_BASE64 } from "../../../electron/signer";

export interface WasmSignInput {
  method: string;
  path: string;
  body?: string | null;
  timestamp: number;
}

export interface WasmSignedRequest {
  signature: string;
  timestamp: number;
  nonce: string;
}

interface WasmSignerExports {
  liner_alloc: (len: number) => number;
  liner_dealloc: (ptr: number, len: number) => void;
  liner_get_result_ptr: () => number;
  liner_get_result_len: () => number;
  liner_sign_cover_url: (ptr: number, len: number) => number;
  liner_sign_request: (...args: [number, number, number, number, number, number, bigint, number, number]) => number;
  liner_sign_monitor_request: (...args: [number, number, number, number, number, number, bigint, number, number]) => number;
  memory: WebAssembly.Memory;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let instancePromise: Promise<WasmSignerExports> | null = null;

// webview needs WebAssembly + i64<->BigInt interop (chrome 85+)
export function isWasmSignerSupported(): boolean {
  return typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function" && typeof BigInt === "function";
}

function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function getExports(): Promise<WasmSignerExports> {
  if (!instancePromise) {
    instancePromise = WebAssembly.instantiate(decodeBase64(SIGNER_WASM_BASE64), {})
      .then(({ instance }) => instance.exports as unknown as WasmSignerExports)
      .catch((err) => {
        instancePromise = null;
        throw err;
      });
  }
  return instancePromise;
}

function pass(wasm: WasmSignerExports, bytes: Uint8Array) {
  const ptr = wasm.liner_alloc(bytes.length);
  new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length, free: () => wasm.liner_dealloc(ptr, bytes.length) };
}

function readResult(wasm: WasmSignerExports): string {
  const ptr = wasm.liner_get_result_ptr();
  const len = wasm.liner_get_result_len();
  if (!ptr || len === 0) return "";
  return decoder.decode(new Uint8Array(wasm.memory.buffer, ptr, len).slice());
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function signWith(
  fn: "liner_sign_request" | "liner_sign_monitor_request",
  input: WasmSignInput,
): Promise<WasmSignedRequest> {
  const wasm = await getExports();
  const nonce = randomNonce();
  const bufs = [input.method, input.path, input.body ?? "", nonce].map((s) => pass(wasm, encoder.encode(s)));
  const [m, p, b, n] = bufs;
  try {
    const code = wasm[fn](m.ptr, m.len, p.ptr, p.len, b.ptr, b.len, BigInt(input.timestamp), n.ptr, n.len);
    if (code !== 0) throw new Error(`wasm ${fn} failed with code ${code}`);
    return { signature: readResult(wasm), timestamp: input.timestamp, nonce };
  } finally {
    bufs.forEach((buf) => buf.free());
  }
}

export function signRequest(input: WasmSignInput): Promise<WasmSignedRequest> {
  return signWith("liner_sign_request", input);
}

export function signMonitorRequest(input: WasmSignInput): Promise<WasmSignedRequest> {
  return signWith("liner_sign_monitor_request", input);
}

export async function signCoverUrl(payload: string): Promise<string> {
  const wasm = await getExports();
  const buf = pass(wasm, encoder.encode(payload));
  try {
    const code = wasm.liner_sign_cover_url(buf.ptr, buf.len);
    if (code !== 0) throw new Error(`wasm sign_cover_url failed with code ${code}`);
    return readResult(wasm);
  } finally {
    buf.free();
  }
}
