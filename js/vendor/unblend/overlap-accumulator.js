/**
 * Bounded overlap-add storage for one separation round.
 *
 * Samples are flushed as soon as no future segment can overlap them. This
 * preserves the full-buffer algorithm's addition/division order while avoiding
 * a second full-track buffer for every source.
 */
export class StreamingOverlapAccumulator {
    ringSamples;
    numChannels;
    step;
    outputBuffers;
    sourceRings;
    weightRing;
    trimStart = 0;
    viewLength = 0;
    flushedThrough = 0;
    roundActive = false;
    constructor(outputs, sources, ringSamples, numChannels, step) {
        this.ringSamples = ringSamples;
        this.numChannels = numChannels;
        this.step = step;
        this.outputBuffers = sources.map(source => outputs[source]);
        this.sourceRings = sources.map(() => new Float32Array(ringSamples * numChannels));
        this.weightRing = new Float32Array(ringSamples);
    }
    /** Reset the circular buffers for a new random-shift round. */
    startRound(trimStart, viewLength) {
        for (const ring of this.sourceRings)
            ring.fill(0);
        this.weightRing.fill(0);
        this.trimStart = trimStart;
        this.viewLength = viewLength;
        this.flushedThrough = 0;
        this.roundActive = true;
    }
    /** Add one preweighted iSTFT chunk and flush samples now known complete. */
    add(chunks, segStart, segLength, weight) {
        if (!this.roundActive) {
            throw new Error('Overlap accumulator round has not been started');
        }
        if (chunks.length !== this.sourceRings.length) {
            throw new Error(`Expected ${this.sourceRings.length} source chunks, got ${chunks.length}`);
        }
        for (let source = 0; source < chunks.length; source++) {
            const chunk = chunks[source];
            const ring = this.sourceRings[source];
            for (let i = 0; i < segLength; i++) {
                const absoluteSample = segStart + i;
                const ringOffset = (absoluteSample % this.ringSamples) * this.numChannels;
                const chunkOffset = i * this.numChannels;
                for (let channel = 0; channel < this.numChannels; channel++) {
                    ring[ringOffset + channel] += chunk[chunkOffset + channel];
                }
            }
        }
        for (let i = 0; i < segLength; i++) {
            const slot = (segStart + i) % this.ringSamples;
            this.weightRing[slot] += weight[i];
        }
        // The next segment starts at segStart + step. Samples before that point
        // cannot receive another contribution and can be normalized and freed.
        this.flush(Math.min(segStart + this.step, this.viewLength));
    }
    /** Verify that the final segment flushed the complete shifted view. */
    finishRound() {
        if (!this.roundActive || this.flushedThrough !== this.viewLength) {
            throw new Error(`Incomplete overlap-add round: flushed ${this.flushedThrough} ` +
                `of ${this.viewLength} samples`);
        }
        this.roundActive = false;
    }
    flush(safeThrough) {
        for (let absoluteSample = this.flushedThrough; absoluteSample < safeThrough; absoluteSample++) {
            const slot = absoluteSample % this.ringSamples;
            const ringOffset = slot * this.numChannels;
            if (absoluteSample >= this.trimStart) {
                const denominator = this.weightRing[slot];
                if (!(denominator > 0)) {
                    throw new Error(`Missing overlap weight at sample ${absoluteSample}`);
                }
                const outputOffset = (absoluteSample - this.trimStart) * this.numChannels;
                for (let source = 0; source < this.sourceRings.length; source++) {
                    const ring = this.sourceRings[source];
                    const output = this.outputBuffers[source];
                    for (let channel = 0; channel < this.numChannels; channel++) {
                        output[outputOffset + channel] +=
                            ring[ringOffset + channel] / denominator;
                    }
                }
            }
            for (const ring of this.sourceRings) {
                for (let channel = 0; channel < this.numChannels; channel++) {
                    ring[ringOffset + channel] = 0;
                }
            }
            this.weightRing[slot] = 0;
        }
        this.flushedThrough = safeThrough;
    }
}
