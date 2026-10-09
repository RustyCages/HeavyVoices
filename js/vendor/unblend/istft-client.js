function asError(reason, fallback) {
    if (reason instanceof Error)
        return reason;
    return new Error(reason === undefined ? fallback : String(reason));
}
export class ISTFTClient {
    worker;
    pendingResolve = null;
    pendingReject = null;
    requestCounter = 0;
    pendingId = -1;
    terminated = false;
    constructor() {
        this.worker = new Worker(new URL('./workers/istft-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event) => {
            if (this.terminated || event.data.requestId !== this.pendingId)
                return;
            const resolve = this.pendingResolve;
            const reject = this.pendingReject;
            this.clearPending();
            if (event.data.success === false) {
                reject?.(new Error(event.data.error || 'iSTFT worker failed'));
                return;
            }
            resolve?.(event.data);
        };
        this.worker.onerror = (error) => {
            console.error('[istft-worker] error:', error);
            this.terminate(error.message || 'iSTFT worker failed');
        };
        this.worker.onmessageerror = (event) => {
            console.error('[istft-worker] message error:', event);
            this.terminate('iSTFT worker message deserialization failed');
        };
    }
    /** Install the model's DSP geometry before the first process call. */
    configure(config) {
        return this.send({ type: 'configure', config }, [], () => undefined);
    }
    process(request) {
        const transfer = [
            request.specReal.buffer,
            request.specImag.buffer,
        ];
        if (request.wave)
            transfer.push(request.wave.buffer);
        return this.send({ type: 'process', ...request }, transfer, result => result);
    }
    terminate(reason) {
        if (this.terminated)
            return;
        this.terminated = true;
        this.rejectPending(asError(reason, 'iSTFT worker terminated'));
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.worker.onmessageerror = null;
        this.worker.terminate();
    }
    clearPending() {
        this.pendingResolve = null;
        this.pendingReject = null;
        this.pendingId = -1;
    }
    rejectPending(reason) {
        const reject = this.pendingReject;
        this.clearPending();
        reject?.(reason);
    }
    send(message, transfer, project) {
        if (this.terminated) {
            return Promise.reject(new Error('iSTFT worker has been terminated'));
        }
        if (this.pendingReject !== null) {
            return Promise.reject(new Error('iSTFT worker request already in progress'));
        }
        const requestId = ++this.requestCounter;
        this.pendingId = requestId;
        return new Promise((resolve, reject) => {
            this.pendingResolve = result => resolve(project(result));
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
