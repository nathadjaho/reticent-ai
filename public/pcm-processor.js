// AudioWorklet: capture mic at the device rate, resample to 24 kHz PCM16,
// and post ~100 ms chunks to the main thread.
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { inputSampleRate, targetSampleRate } = options.processorOptions;
    this.ratio = inputSampleRate / targetSampleRate;
    this.pos = 0;
    this.buf = new Int16Array(2400);
    this.n = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    while (this.pos < input.length) {
      const s = input[Math.floor(this.pos)] ?? 0;
      this.buf[this.n++] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Int16Array(2400);
        this.n = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= input.length;
    return true;
  }
}
registerProcessor("pcm-processor", PCMProcessor);
