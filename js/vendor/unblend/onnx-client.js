/**
 * A failed ``OnnxClient.load``. ``stage`` separates download failures
 * (network, HTTP status, truncation), which another backend cannot fix, from
 * session-creation failures, which carry the fetched bytes for a retry.
 */
export class ModelLoadError extends Error {
    stage;
    modelBytes;
    constructor(message, stage, modelBytes) {
        super(message);
        this.name = 'ModelLoadError';
        this.stage = stage;
        this.modelBytes = modelBytes;
    }
}
function asError(reason, fallback) {
    if (reason instanceof Error)
        return reason;
    return new Error(reason === undefined ? fallback : String(reason));
}
export class OnnxClient {
    worker;
    pendingResolve = null;
    pendingReject = null;
    requestCounter = 0;
    pendingId = -1;
    pendingProgress = null;
    terminated = false;
    constructor() {
        this.worker = new Worker(new URL('./workers/onnx-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event) => {
            if (this.terminated || event.data.requestId !== this.pendingId)
                return;
            if (event.data.type === 'progress') {
                this.pendingProgress?.(event.data);
                return;
            }
            const resolve = this.pendingResolve;
            this.clearPending();
            resolve?.(event.data);
        };
        this.worker.onerror = (error) => {
            console.error('[onnx-worker] error:', error);
            this.terminate(error.message || 'ONNX worker failed');
        };
        this.worker.onmessageerror = (event) => {
            console.error('[onnx-worker] message error:', event);
            this.terminate('ONNX worker message deserialization failed');
        };
    }
    async load(modelUrl, backend, options = {}, onProgress) {
        const response = (await this.send({
            type: 'load',
            modelUrl,
            model: options.model,
            cache: options.cache,
            expectedBytes: options.expectedBytes,
            modelBytes: options.modelBytes,
            returnBytesOnFailure: options.returnBytesOnFailure,
            backend,
            wasmPaths: options.wasmPaths,
            numThreads: options.numThreads,
            graphOptimizationLevel: options.graphOptimizationLevel,
        }, options.modelBytes ? [options.modelBytes.buffer] : [], onProgress && (msg => onProgress(msg.phase, msg.loaded, msg.total, msg.source))));
        if (!response.success) {
            throw new ModelLoadError(response.error || 'Model load failed', response.stage ?? 'session', response.modelBytes);
        }
    }
    async runInference(specReal, specImag, specShape, audio, audioShape) {
        // The spectrogram buffers are no longer read by the pipeline, so
        // transfer ownership instead of cloning their multi-megabyte payloads.
        // ``audio`` is the pipeline's reusable planar buffer, so it is cloned
        // (synchronously, by postMessage) rather than transferred.
        const response = (await this.send({
            type: 'run',
            specReal,
            specImag,
            audio,
            specShape,
            audioShape,
        }, [specReal.buffer, specImag.buffer]));
        if (!response.success) {
            throw new Error(response.error || 'Inference failed');
        }
        return {
            outSpecReal: response.outSpecReal,
            outSpecImag: response.outSpecImag,
            outWave: response.outWave,
            outSpecShape: response.outSpecShape,
            outWaveShape: response.outWaveShape,
        };
    }
    async unload() {
        await this.send({ type: 'unload' });
    }
    terminate(reason) {
        if (this.terminated)
            return;
        this.terminated = true;
        this.rejectPending(asError(reason, 'ONNX worker terminated'));
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.worker.onmessageerror = null;
        this.worker.terminate();
    }
    clearPending() {
        this.pendingResolve = null;
        this.pendingReject = null;
        this.pendingId = -1;
        this.pendingProgress = null;
    }
    rejectPending(reason) {
        const reject = this.pendingReject;
        this.clearPending();
        reject?.(reason);
    }
    send(message, transfer = [], onProgress) {
        if (this.terminated) {
            return Promise.reject(new Error('ONNX worker has been terminated'));
        }
        if (this.pendingReject !== null) {
            return Promise.reject(new Error('ONNX worker request already in progress'));
        }
        const requestId = ++this.requestCounter;
        this.pendingId = requestId;
        this.pendingProgress = onProgress ?? null;
        return new Promise((resolve, reject) => {
            this.pendingResolve = resolve;
            this.pendingReject = reject;
            try {
                this.worker.postMessage({ ...message, requestId }, transfer);
            }
            catch (error) {
                if (this.pendingId === requestId)
                    this.clearPending();
                reject(error);
            }
        });
    }
}
