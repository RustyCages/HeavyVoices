import { MODEL_CONFIGS, SAMPLE_RATE, dspConfig, } from './constants.js';
import { MODEL_ARTIFACTS } from './model-artifacts.js';
import { ModelLoadError, OnnxClient, } from './onnx-client.js';
import { STFTClient } from './stft-client.js';
import { ISTFTClient } from './istft-client.js';
import { runPipeline, validateSeparationOptions, } from './pipeline.js';
function abortReason(signal) {
    return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}
function throwIfAborted(signal) {
    if (signal?.aborted)
        throw abortReason(signal);
}
function awaitWithSignal(promise, signal) {
    if (!signal)
        return promise;
    if (signal.aborted)
        return Promise.reject(abortReason(signal));
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback) => {
            if (settled)
                return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            callback();
        };
        const onAbort = () => finish(() => reject(abortReason(signal)));
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    });
}
async function isWebGPUAvailable() {
    if (!navigator.gpu)
        return false;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter !== null;
    }
    catch {
        return false;
    }
}
export class Separator {
    model;
    sources;
    backend;
    precision;
    /** License of the model weights. */
    license;
    config;
    onnx;
    stft;
    istft;
    disposed = false;
    active = false;
    constructor(model, config, backend, precision, onnx, stft, istft) {
        this.model = model;
        this.config = config;
        this.sources = config.sources;
        this.license = config.license;
        this.backend = backend;
        this.precision = precision;
        this.onnx = onnx;
        this.stft = stft;
        this.istft = istft;
    }
    /** Load a model and return a ready-to-use Separator. */
    static async load(model, options = {}) {
        // This check intentionally precedes model validation and worker creation.
        throwIfAborted(options.signal);
        const preferredBackend = options.backend ?? 'webgpu';
        if (preferredBackend !== 'webgpu' && preferredBackend !== 'wasm') {
            throw new Error(`Unknown backend '${preferredBackend}'. Valid backends: webgpu, wasm.`);
        }
        const precision = options.precision ?? 'fp32';
        // Own-property checks: a name like 'constructor' or 'toString' must be
        // rejected, not resolved through Object.prototype.
        if (typeof model !== 'string' || !Object.hasOwn(MODEL_ARTIFACTS, model)) {
            throw new Error(`Unknown model '${model}'. Valid models: ${Object.keys(MODEL_ARTIFACTS).join(', ')}.`);
        }
        const modelArtifacts = MODEL_ARTIFACTS[model];
        if (typeof precision !== 'string' || !Object.hasOwn(modelArtifacts, precision)) {
            throw new Error(`Unknown precision '${precision}'. Valid precisions: ${Object.keys(modelArtifacts).join(', ')}.`);
        }
        const artifact = modelArtifacts[precision];
        const modelUrl = options.modelUrl ?? artifact.url;
        const config = MODEL_CONFIGS[model];
        if (preferredBackend === 'wasm' && config.webgpuRequired) {
            throw new Error(`${model} requires WebGPU; its inference working set exceeds `
                + `the WebAssembly runtime's fixed memory heap.`);
        }
        let onnx = null;
        let stft = null;
        let istft = null;
        const cleanup = (reason) => {
            onnx?.terminate(reason);
            stft?.terminate(reason);
            istft?.terminate(reason);
        };
        const onAbort = () => cleanup(abortReason(options.signal));
        options.signal?.addEventListener('abort', onAbort, { once: true });
        try {
            const webgpuAvailable = preferredBackend === 'webgpu'
                && await awaitWithSignal(isWebGPUAvailable(), options.signal);
            if (preferredBackend === 'webgpu' && !webgpuAvailable && config.webgpuRequired) {
                throw new Error(`${model} requires WebGPU, but this browser did not expose `
                    + `a usable WebGPU adapter.`);
            }
            let backend = webgpuAvailable ? 'webgpu' : 'wasm';
            throwIfAborted(options.signal);
            onnx = new OnnxClient();
            const workerOptions = {
                wasmPaths: options.wasmPaths,
                numThreads: options.numThreads,
                graphOptimizationLevel: options.graphOptimizationLevel,
                model,
                cache: options.modelUrl === undefined && options.cache !== false
                    ? { key: artifact.url, expectedBytes: artifact.sizeBytes }
                    : undefined,
                // An overridden URL's size is unknown; registered artifacts
                // must match their attested size whether or not they cache.
                expectedBytes: options.modelUrl === undefined ? artifact.sizeBytes : undefined,
            };
            const canFallBack = backend === 'webgpu' && !config.webgpuRequired;
            try {
                await awaitWithSignal(onnx.load(modelUrl, backend, { ...workerOptions, returnBytesOnFailure: canFallBack }, options.onProgress), options.signal);
            }
            catch (error) {
                // Never reinterpret an abort as a WebGPU failure/fallback.
                throwIfAborted(options.signal);
                if (!canFallBack)
                    throw error;
                // A failed download would fail identically on WASM.
                if (error instanceof ModelLoadError && error.stage === 'fetch')
                    throw error;
                console.warn(`[unblend] ${model} failed to initialize with WebGPU; falling back to WASM:`, error);
                onnx.terminate(error);
                backend = 'wasm';
                onnx = new OnnxClient();
                const modelBytes = error instanceof ModelLoadError ? error.modelBytes : undefined;
                await awaitWithSignal(onnx.load(modelUrl, backend, { ...workerOptions, modelBytes }, options.onProgress), options.signal);
            }
            throwIfAborted(options.signal);
            stft = new STFTClient();
            istft = new ISTFTClient();
            await awaitWithSignal(Promise.all([
                stft.configure(dspConfig(config)),
                istft.configure(dspConfig(config)),
            ]), options.signal);
            throwIfAborted(options.signal);
            return new Separator(model, config, backend, precision, onnx, stft, istft);
        }
        catch (error) {
            cleanup(error);
            throw error;
        }
        finally {
            options.signal?.removeEventListener('abort', onAbort);
        }
    }
    /**
     * Separate one 44.1kHz AudioBuffer. Calls on one instance are sequential.
     * Abort or any worker-backed failure invalidates this instance permanently.
     */
    async separate(audioBuffer, options = {}) {
        if (this.disposed) {
            throw new Error('Separator is no longer usable (it was unloaded, or an earlier separation was '
                + 'aborted or failed); load a new one');
        }
        if (this.active)
            throw new Error('Separation already in progress');
        if (audioBuffer.sampleRate !== SAMPLE_RATE) {
            throw new Error(`Separator expects ${SAMPLE_RATE} Hz audio, got ${audioBuffer.sampleRate} Hz. `
                + `Resample the AudioBuffer to ${SAMPLE_RATE} Hz before calling separate().`);
        }
        if (audioBuffer.length === 0)
            throw new Error('audioBuffer is empty (0 samples).');
        validateSeparationOptions(options);
        throwIfAborted(options.signal);
        this.active = true;
        const onAbort = () => this.hardInvalidate(abortReason(options.signal));
        options.signal?.addEventListener('abort', onAbort, { once: true });
        try {
            const result = await runPipeline({ onnx: this.onnx, stft: this.stft, istft: this.istft }, audioBuffer, this.config, options);
            throwIfAborted(options.signal);
            return result;
        }
        catch (error) {
            this.hardInvalidate(options.signal?.aborted ? abortReason(options.signal) : error);
            throw options.signal?.aborted ? abortReason(options.signal) : error;
        }
        finally {
            options.signal?.removeEventListener('abort', onAbort);
            this.active = false;
        }
    }
    /** Release resources. Active work is cancelled destructively. */
    async unload() {
        if (this.disposed)
            return;
        if (this.active) {
            this.hardInvalidate(new Error('Separator unloaded during active separation'));
            return;
        }
        this.disposed = true;
        let timer;
        try {
            await Promise.race([
                this.onnx.unload(),
                new Promise(resolve => {
                    timer = setTimeout(resolve, 2000);
                }),
            ]);
        }
        catch {
            // The worker may already be unhealthy; termination below is final.
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
            this.terminateWorkers();
        }
    }
    hardInvalidate(reason) {
        if (this.disposed)
            return;
        this.disposed = true;
        this.terminateWorkers(reason);
    }
    terminateWorkers(reason) {
        this.onnx.terminate(reason);
        this.stft.terminate(reason);
        this.istft.terminate(reason);
    }
}
