/**
 * Web Worker for ISTFT computation.
 * Runs ISTFT + freq/time branch combination + overlap-add weighting. Lives in
 * its own worker so it overlaps with the STFT and ONNX workers rather than
 * blocking the main thread.
 *
 * The client sends one 'configure' message (model DSP geometry) before the
 * first 'process' (Separator.load always does); 'process' on an unconfigured
 * worker is an error.
 * RoFormer and SCNet models have no time branch: 'process' arrives without
 * ``wave`` and the chunk is the weighted iSTFT alone.
 */
import { createDSP } from '../audio-processor.js';
import { createSplitWeight } from '../constants.js';
let dsp = null;
let splitWeight = null;
let sourceReal = null;
let sourceImag = null;
function setup(config) {
    dsp = createDSP(config);
    splitWeight = createSplitWeight(config.chunkSamples ?? config.segmentSamples);
    // Largest per-channel spectrogram the ONNX model can emit for one
    // segment, ×2 channels. Derived from the DSP so it can't silently
    // undersize (the STFT producer uses the same geometry).
    const maxSpecSize = 2 * dsp.numBins * dsp.numFrames;
    sourceReal = new Float32Array(maxSpecSize);
    sourceImag = new Float32Array(maxSpecSize);
}
self.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === 'configure') {
        try {
            setup(msg.config);
            const response = {
                type: 'result',
                requestId: msg.requestId,
                success: true,
            };
            self.postMessage(response);
        }
        catch (error) {
            console.error('[istft-worker] configure failed:', error);
            const response = {
                type: 'result',
                requestId: msg.requestId,
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
            self.postMessage(response);
        }
        return;
    }
    try {
        if (!dsp)
            throw new Error('iSTFT worker used before configure');
        const { specReal, specImag, wave, numSources, numChannels, numBins, numFrames, segStart, segLength, trimOffset, } = msg;
        const segmentSamples = dsp.segmentSamples;
        const specSize = numChannels * numBins * numFrames;
        const chunks = [];
        for (let s = 0; s < numSources; s++) {
            const specOffset = s * specSize;
            sourceReal.set(specReal.subarray(specOffset, specOffset + specSize));
            sourceImag.set(specImag.subarray(specOffset, specOffset + specSize));
            const freqAudio = dsp.computeISTFT(sourceReal, sourceImag, numChannels, numBins, numFrames);
            // Combine freq + time branches (when the model has one), apply the
            // triangular weight, write to the output chunk. Matches Python:
            // center_trim to the chunk, then weight[:chunk_length] (the
            // triangle indexed from 0, not centered).
            const sourceWaveOffset = s * numChannels * segmentSamples;
            const chunk = new Float32Array(segLength * numChannels);
            for (let i = 0; i < segLength; i++) {
                const srcIdx = trimOffset + i;
                let leftVal = freqAudio[srcIdx];
                let rightVal = freqAudio[segmentSamples + srcIdx];
                if (wave) {
                    leftVal += wave[sourceWaveOffset + srcIdx];
                    rightVal += wave[sourceWaveOffset + segmentSamples + srcIdx];
                }
                const w = splitWeight[i];
                chunk[i * numChannels] = leftVal * w;
                chunk[i * numChannels + 1] = rightVal * w;
            }
            chunks.push(chunk);
        }
        const response = {
            type: 'result',
            requestId: msg.requestId,
            success: true,
            chunks,
            segStart,
            segLength,
        };
        // Transfer ownership of chunk buffers to avoid copying
        self.postMessage(response, { transfer: chunks.map(c => c.buffer) });
    }
    catch (error) {
        console.error('[istft-worker] process failed:', error);
        const response = {
            type: 'result',
            requestId: msg.requestId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
        self.postMessage(response);
    }
};
