/**
 * ONNX Runtime worker for both the WebGPU and WASM backends. Model IO is
 * always float32, including "fp16" artifacts: the exporter inserts the Cast
 * boundaries, so callers always exchange fp32 tensors with the worker.
 */
import * as onnx from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.bundle.min.mjs';  // HV: ingen bundler – samma version som unblend 1.0.0 kräver
import { MODEL_CONFIGS } from '../constants.js';
import { loadModelBytes } from '../model-fetch.js';
import { checkModelMetadata, readOnnxMetadata } from '../model-metadata.js';
let session = null;
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * A bundler may put onnxruntime-web in the same chunk as this worker, and
 * ORT's multi-threaded WASM backend spawns its pthread workers from that
 * chunk's URL (named "em-pthread..."). Those workers evaluate this module too,
 * so this handler must neither replace ORT's own `self.onmessage` there (its
 * threads would never start and session creation would hang) nor react to
 * ORT's internal messages.
 */
const isOrtThread = typeof self.name === 'string' && self.name.startsWith('em-pthread');
async function handleMessage(event) {
    const msg = event.data;
    if (msg === null || typeof msg !== 'object' || typeof msg.requestId !== 'number') {
        return;
    }
    if (msg.type === 'load') {
        let stage = 'fetch';
        let modelBytes;
        try {
            // Only override wasmPaths if the caller asked us to. Otherwise let
            // ORT resolve .wasm files via the bundler's default (next to the
            // bundled JS, via import.meta.url).
            if (msg.wasmPaths !== undefined) {
                onnx.env.wasm.wasmPaths = msg.wasmPaths;
            }
            // numThreads only affects the WASM backend. Setting >1 on a page
            // that isn't cross-origin isolated can fail/warn at session create,
            // so only apply it when WASM is actually the execution provider.
            if (msg.backend === 'wasm') {
                onnx.env.wasm.numThreads = msg.numThreads ?? 4;
            }
            onnx.env.logLevel = 'warning';
            const fetched = msg.modelBytes === undefined;
            modelBytes = msg.modelBytes ?? await loadModelBytes(msg.modelUrl, (loaded, total, source) => {
                const progress = {
                    type: 'progress',
                    requestId: msg.requestId,
                    phase: 'download',
                    loaded,
                    total,
                    source,
                };
                self.postMessage(progress);
            }, msg.cache, msg.expectedBytes);
            // A wrong file is a fetch-stage failure, like a wrong size: it
            // would fail identically on any backend. Handed-back retry bytes
            // were already checked on the first attempt.
            if (fetched && msg.model !== undefined) {
                checkModelMetadata(readOnnxMetadata(modelBytes), msg.model, MODEL_CONFIGS[msg.model]);
            }
            stage = 'session';
            const compiling = {
                type: 'progress',
                requestId: msg.requestId,
                phase: 'compile',
                loaded: 0,
                total: 0,
            };
            self.postMessage(compiling);
            session = await onnx.InferenceSession.create(modelBytes, {
                executionProviders: [msg.backend],
                graphOptimizationLevel: msg.graphOptimizationLevel ?? 'all',
            });
            const response = {
                type: 'load',
                requestId: msg.requestId,
                success: true,
                backend: msg.backend,
            };
            self.postMessage(response);
        }
        catch (error) {
            console.error('[onnx-worker] load failed:', error);
            const response = {
                type: 'load',
                requestId: msg.requestId,
                success: false,
                error: errorMessage(error),
                stage,
            };
            // Hand intact bytes back so a fallback backend need not download
            // them again. ORT copies them into its own heap, so they are
            // normally still attached here.
            if (msg.returnBytesOnFailure
                && stage === 'session'
                && modelBytes
                && modelBytes.buffer.byteLength > 0) {
                response.modelBytes = modelBytes;
                self.postMessage(response, [modelBytes.buffer]);
            }
            else {
                self.postMessage(response);
            }
        }
        return;
    }
    if (msg.type === 'run') {
        if (!session) {
            const response = {
                type: 'run',
                requestId: msg.requestId,
                success: false,
                error: 'No session loaded',
            };
            self.postMessage(response);
            return;
        }
        // Track every tensor created in this run for the finally block —
        // otherwise a failed run leaks WASM-heap/GPU buffers per segment
        // until the worker is torn down.
        const owned = [];
        try {
            // Push each tensor as soon as it exists — if a later constructor
            // throws, the earlier ones must still reach the finally block.
            const specReal = new onnx.Tensor('float32', msg.specReal, msg.specShape);
            owned.push(specReal);
            const specImag = new onnx.Tensor('float32', msg.specImag, msg.specShape);
            owned.push(specImag);
            const feeds = {
                spec_real: specReal,
                spec_imag: specImag,
            };
            if (msg.audio !== undefined) {
                const audio = new onnx.Tensor('float32', msg.audio, msg.audioShape);
                owned.push(audio);
                feeds.audio = audio;
            }
            const results = await session.run(feeds);
            for (const tensor of Object.values(results)) {
                owned.push(tensor);
            }
            const outSpecReal = results.out_spec_real;
            const outSpecImag = results.out_spec_imag;
            const outWave = results.out_wave;
            // The model's IO is float32 by design (Cast nodes bracket fp16
            // graphs). The .data casts below are unchecked, so a model whose
            // outputs are some other dtype would be silently mis-wrapped as
            // Float32Array. Verify the dtype up front so a mismatched model
            // fails loudly instead. out_wave exists only on HTDemucs graphs;
            // it is checked when present and its absence is reported to the
            // client (which knows whether the model should have one).
            const expected = [
                ['out_spec_real', outSpecReal],
                ['out_spec_imag', outSpecImag],
            ];
            if (outWave !== undefined) {
                expected.push(['out_wave', outWave]);
            }
            for (const [name, tensor] of expected) {
                if (tensor === undefined) {
                    throw new Error(`Model produced no '${name}' output`);
                }
                if (tensor.type !== 'float32') {
                    throw new Error(`Expected output '${name}' to be float32, got '${tensor.type}'`);
                }
            }
            // Only out_spec_real's dims are forwarded as outSpecShape, so
            // make sure the imag plane actually shares them.
            if (outSpecImag.dims.join(',') !== outSpecReal.dims.join(',')) {
                throw new Error(`out_spec_imag dims [${outSpecImag.dims}] differ from ` +
                    `out_spec_real dims [${outSpecReal.dims}]`);
            }
            // Copy the outputs out of the tensors' backing storage so the
            // finally block can dispose them; left to GC finalizers, WASM-heap
            // and GPU buffers would accumulate across every segment.
            const outSpecRealData = new Float32Array(outSpecReal.data);
            const outSpecImagData = new Float32Array(outSpecImag.data);
            const outWaveData = outWave
                ? new Float32Array(outWave.data)
                : undefined;
            const outSpecShape = outSpecReal.dims;
            const outWaveShape = outWave ? outWave.dims : undefined;
            const response = {
                type: 'run',
                requestId: msg.requestId,
                success: true,
                outSpecReal: outSpecRealData,
                outSpecImag: outSpecImagData,
                outWave: outWaveData,
                outSpecShape,
                outWaveShape,
            };
            // Transfer rather than structured-clone the multi-MB outputs.
            const transfer = [
                outSpecRealData.buffer,
                outSpecImagData.buffer,
            ];
            if (outWaveData) {
                transfer.push(outWaveData.buffer);
            }
            self.postMessage(response, transfer);
        }
        catch (error) {
            console.error('[onnx-worker] run failed:', error);
            const response = {
                type: 'run',
                requestId: msg.requestId,
                success: false,
                error: errorMessage(error),
            };
            self.postMessage(response);
        }
        finally {
            for (const tensor of owned.splice(0)) {
                try {
                    tensor.dispose();
                }
                catch {
                    // Best-effort cleanup; the response already went out.
                }
            }
        }
        return;
    }
    if (msg.type === 'unload') {
        // Always post the response, even if release() throws — otherwise the
        // client's unload() promise never settles and the caller hangs.
        try {
            if (session) {
                await session.release();
            }
        }
        catch (error) {
            console.error('[onnx-worker] release failed:', error);
        }
        finally {
            session = null;
            const response = {
                type: 'unload',
                requestId: msg.requestId,
                success: true,
            };
            self.postMessage(response);
        }
        return;
    }
}
if (!isOrtThread) {
    // addEventListener, not onmessage, so nothing else on this global is clobbered.
    self.addEventListener('message', (event) => {
        void handleMessage(event);
    });
}
