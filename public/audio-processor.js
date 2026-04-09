// audio-processor.js
// AudioWorkletProcessor for Opus PCM playback and capture

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(0);
    this.port.onmessage = (e) => {
      if (e.data.type === 'pcm') {
        const newData = e.data.pcm;
        const newBuffer = new Float32Array(this.buffer.length + newData.length);
        newBuffer.set(this.buffer, 0);
        newBuffer.set(newData, this.buffer.length);
        this.buffer = newBuffer;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const channel = output[0];

    if (this.buffer.length >= channel.length) {
      channel.set(this.buffer.subarray(0, channel.length));
      this.buffer = this.buffer.subarray(channel.length);
    } else {
      // Underflow: pad with zeros
      channel.set(this.buffer);
      channel.fill(0, this.buffer.length);
      this.buffer = new Float32Array(0);
    }

    return true;
  }
}

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channel = input[0];
      // Send the Float32Array to the main thread
      this.port.postMessage({ type: 'pcm', pcm: new Float32Array(channel) });
    }
    return true;
  }
}

registerProcessor('playback-processor', PlaybackProcessor);
registerProcessor('capture-processor', CaptureProcessor);
