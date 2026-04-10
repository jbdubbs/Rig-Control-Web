// audio-processor.js
// AudioWorkletProcessor for Opus PCM playback and capture

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(0);
    this.isPlaying = false;
    
    // Jitter Buffer Settings (at 48kHz)
    // 1 frame = 20ms = 960 samples
    this.MIN_BUFFER_SAMPLES = 960 * 3; // 60ms (Start playing when we have 3 frames)
    this.MAX_BUFFER_SAMPLES = 960 * 12; // 240ms (Drop audio if we exceed 12 frames to prevent latency buildup)

    this.port.onmessage = (e) => {
      if (e.data.type === 'pcm') {
        const newData = e.data.pcm;
        const newBuffer = new Float32Array(this.buffer.length + newData.length);
        newBuffer.set(this.buffer, 0);
        newBuffer.set(newData, this.buffer.length);
        
        // Overflow protection: If the buffer gets too large (e.g. OS sent a huge burst),
        // drop the oldest data to catch up to real-time.
        if (newBuffer.length > this.MAX_BUFFER_SAMPLES) {
          this.buffer = newBuffer.subarray(newBuffer.length - this.MAX_BUFFER_SAMPLES);
        } else {
          this.buffer = newBuffer;
        }

        // Start playing once we have enough buffered
        if (!this.isPlaying && this.buffer.length >= this.MIN_BUFFER_SAMPLES) {
          this.isPlaying = true;
        }
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const channel = output[0];

    if (this.isPlaying && this.buffer.length >= channel.length) {
      channel.set(this.buffer.subarray(0, channel.length));
      this.buffer = this.buffer.subarray(channel.length);
    } else {
      // Underflow: pause playback and wait for buffer to fill again
      this.isPlaying = false;
      channel.fill(0);
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
