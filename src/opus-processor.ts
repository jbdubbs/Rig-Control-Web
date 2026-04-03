// src/opus-processor.ts
declare const AudioWorkletProcessor: any;
declare const registerProcessor: any;

// This is an AudioWorkletProcessor that handles Opus decoding and encoding using WASM.
// It is designed to work with the WASM binaries from the opus-recorder package.

class OpusProcessor extends AudioWorkletProcessor {
  private wasmInstance: any = null;
  private decoder: number = 0;
  private encoder: number = 0;
  private resampler: number = 0;
  private encoderResampler: number = 0;
  
  private decoderBufferPointer: number = 0;
  private decoderBuffer: Uint8Array | null = null;
  private decoderBufferIndex: number = 0;
  private decoderOutputPointer: number = 0;
  private decoderOutputMaxLength: number = 0;
  private decoderOutputLengthPointer: number = 0;
  
  private resampleOutputBufferPointer: number = 0;
  private resampleOutputLengthPointer: number = 0;

  private encoderInputBufferPointer: number = 0;
  private encoderInputLengthPointer: number = 0;
  private encoderOutputBufferPointer: number = 0;
  private encoderOutputMaxLength: number = 0;
  
  private HEAPU8: Uint8Array | null = null;
  private HEAP32: Int32Array | null = null;
  private HEAPF32: Float32Array | null = null;
  
  private dataBuffer: Uint8Array = new Uint8Array(0);

  private outputRingBuffer: Float32Array = new Float32Array(16000 * 2); // 2 seconds of buffer
  private readIndex: number = 0;
  private writeIndex: number = 0;
  private bufferCount: number = 0;

  private config = {
    decoderSampleRate: 48000,
    encoderSampleRate: 48000,
    outputBufferSampleRate: 16000, // Will be updated to match AudioContext sampleRate
    inputBufferSampleRate: 16000,
    resampleQuality: 3,
    numberOfChannels: 1,
    bitrate: 24000,
    frameDuration: 20 // ms
  };

  private pcmBuffer: Float32Array = new Float32Array(320); // 20ms at 16k
  private pcmBufferIndex: number = 0;

  private oggPageSequence: number = 0;
  private oggGranulePosition: number = 0;

  constructor() {
    super();
    this.port.onmessage = this.handleMessage.bind(this);
    // @ts-ignore
    this.config.outputBufferSampleRate = sampleRate;
    // @ts-ignore
    this.config.inputBufferSampleRate = sampleRate;
    this.outputRingBuffer = new Float32Array(this.config.outputBufferSampleRate * 2);
    this.pcmBuffer = new Float32Array(this.config.outputBufferSampleRate * 20 / 1000);
  }

  private async handleMessage(event: MessageEvent) {
    const { type, data, wasmBinary } = event.data;

    if (type === 'init') {
      await this.initWasm(wasmBinary);
    } else if (type === 'decode') {
      if (this.wasmInstance) {
        this.decodeOgg(data);
      }
    }
  }

  private log(msg: string) {
    this.port.postMessage({ type: 'log', message: msg });
  }

  private async initWasm(wasmBinary: ArrayBuffer) {
    this.log("Initializing Opus WASM...");
    const importObject = {
      env: {
        memory: new WebAssembly.Memory({ initial: 256, maximum: 256 }),
        abort: () => { this.log("WASM aborted"); },
        _abort: () => { this.log("WASM aborted"); },
        _emscripten_memcpy_big: (dest: number, src: number, num: number) => {
          this.HEAPU8!.copyWithin(dest, src, src + num);
        },
        _emscripten_resize_heap: (size: number) => { return false; },
        _fd_close: () => 0,
        _fd_seek: () => 0,
        _fd_write: () => 0,
        __wasm_call_ctors: () => {}
      },
      a: { // Emscripten often uses 'a' for some exports
        c: () => { this.log("WASM aborted"); },
        e: (dest: number, src: number, num: number) => {
          this.HEAPU8!.copyWithin(dest, src, src + num);
        },
        f: (size: number) => { return false; },
        d: () => 0,
        b: () => 0,
        a: () => 0
      }
    };

    try {
      const { instance } = await WebAssembly.instantiate(wasmBinary, importObject);
      this.wasmInstance = instance;
      const exports: any = instance.exports;

      const buffer = exports.g.buffer; // 'g' is usually the memory export in these builds
      this.HEAPU8 = new Uint8Array(buffer);
      this.HEAP32 = new Int32Array(buffer);
      this.HEAPF32 = new Float32Array(buffer);

      // Initialize Decoder
      const errPtr = exports.o(4); // malloc(4)
      this.decoder = exports.i(this.config.decoderSampleRate, this.config.numberOfChannels, errPtr); // _opus_decoder_create
      exports.p(errPtr); // free

      this.decoderBufferIndex = 0;
      const decoderBufferMaxLength = 4000;
      this.decoderBufferPointer = exports.o(decoderBufferMaxLength); // malloc
      this.decoderBuffer = this.HEAPU8.subarray(this.decoderBufferPointer, this.decoderBufferPointer + decoderBufferMaxLength);
      
      this.decoderOutputLengthPointer = exports.o(4); // malloc
      this.decoderOutputMaxLength = this.config.decoderSampleRate * this.config.numberOfChannels * 120 / 1000;
      this.decoderOutputPointer = exports.o(4 * this.decoderOutputMaxLength); // malloc

      // Initialize Decoder Resampler (48k -> AudioContext sampleRate)
      const resampleErrPtr = exports.o(4); // malloc
      this.resampler = exports.l(this.config.numberOfChannels, this.config.decoderSampleRate, this.config.outputBufferSampleRate, this.config.resampleQuality, resampleErrPtr); // _speex_resampler_init
      exports.p(resampleErrPtr); // free

      this.resampleOutputLengthPointer = exports.o(4); // malloc
      const resampleOutputMaxLength = Math.ceil(this.decoderOutputMaxLength * this.config.outputBufferSampleRate / this.config.decoderSampleRate);
      this.resampleOutputBufferPointer = exports.o(4 * resampleOutputMaxLength); // malloc

      // Initialize Encoder
      const encErrPtr = exports.o(4); // malloc
      this.encoder = exports.q(this.config.encoderSampleRate, this.config.numberOfChannels, 2048, encErrPtr); // _opus_encoder_create (2048 = OPUS_APPLICATION_VOIP)
      exports.p(encErrPtr); // free
      
      // Set bitrate
      const bitratePtr = exports.o(4);
      this.HEAP32![bitratePtr >> 2] = this.config.bitrate;
      exports.r(this.encoder, 4002, bitratePtr); // _opus_encoder_ctl (4002 = OPUS_SET_BITRATE)
      exports.p(bitratePtr);

      // Initialize Encoder Resampler (AudioContext sampleRate -> Encoder 48k)
      const encResampleErrPtr = exports.o(4);
      this.encoderResampler = exports.l(this.config.numberOfChannels, this.config.inputBufferSampleRate, this.config.encoderSampleRate, this.config.resampleQuality, encResampleErrPtr);
      exports.p(encResampleErrPtr);

      this.encoderInputLengthPointer = exports.o(4);
      this.encoderOutputMaxLength = 4000;
      this.encoderOutputBufferPointer = exports.o(this.encoderOutputMaxLength);
      this.encoderInputBufferPointer = exports.o(4 * this.config.encoderSampleRate * this.config.numberOfChannels * 120 / 1000);

      // Send Ogg Headers
      this.sendOggHeaders();

      this.port.postMessage({ type: 'initialized' });
      this.log("Opus WASM initialized successfully");
    } catch (e) {
      this.log(`Failed to initialize Opus WASM: ${e}`);
    }
  }

  private sendOggHeaders() {
    // OpusHead
    const opusHead = new Uint8Array([
      0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // "OpusHead"
      0x01, // Version
      this.config.numberOfChannels,
      0x00, 0x00, // Pre-skip
      0x80, 0xBB, 0x00, 0x00, // Original sample rate (48000)
      0x00, 0x00, // Output gain
      0x00 // Mapping family
    ]);
    this.sendOggPage(opusHead, 2); // Header type 2 = BOS

    // OpusTags
    const opusTags = new Uint8Array([
      0x4F, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73, // "OpusTags"
      0x08, 0x00, 0x00, 0x00, 0x61, 0x69, 0x73, 0x74, 0x75, 0x64, 0x69, 0x6F, // Vendor length + "aistudio"
      0x00, 0x00, 0x00, 0x00 // User comment list length
    ]);
    this.sendOggPage(opusTags, 0);
  }

  private sendOggPage(packet: Uint8Array, headerType: number) {
    const pageHeader = new Uint8Array(27 + 1);
    pageHeader.set([0x4F, 0x67, 0x67, 0x53], 0); // "OggS"
    pageHeader[4] = 0; // Version
    pageHeader[5] = headerType;
    
    // Granule position
    const granule = BigInt(this.oggGranulePosition);
    for (let i = 0; i < 8; i++) {
      pageHeader[6 + i] = Number((granule >> BigInt(i * 8)) & 0xFFn);
    }

    // Serial number (fixed for this stream)
    pageHeader.set([0x01, 0x02, 0x03, 0x04], 14);
    
    // Page sequence
    const seq = this.oggPageSequence++;
    pageHeader[18] = seq & 0xFF;
    pageHeader[19] = (seq >> 8) & 0xFF;
    pageHeader[20] = (seq >> 16) & 0xFF;
    pageHeader[21] = (seq >> 24) & 0xFF;

    pageHeader[26] = 1; // Segment count
    pageHeader[27] = packet.length; // Segment length

    // Checksum (placeholder)
    // ...

    const page = new Uint8Array(pageHeader.length + packet.length);
    page.set(pageHeader, 0);
    page.set(packet, pageHeader.length);

    this.port.postMessage({ type: 'encoded', data: page });
  }

  private encodePcm(data: Float32Array) {
    if (!this.wasmInstance) return;

    // Resample AudioContext sampleRate -> 48k
    const inputSamples = data.length;
    const outputSamples = Math.ceil(inputSamples * this.config.encoderSampleRate / this.config.inputBufferSampleRate);
    
    this.HEAPF32!.set(data, this.encoderInputBufferPointer >> 2);
    this.HEAP32![this.encoderInputLengthPointer >> 2] = inputSamples;
    this.HEAP32![this.resampleOutputLengthPointer >> 2] = outputSamples;

    this.wasmInstance.exports.n( // _speex_resampler_process_interleaved_float
      this.encoderResampler,
      this.encoderInputBufferPointer,
      this.encoderInputLengthPointer,
      this.decoderOutputPointer, // Reuse decoder output pointer as temp resample buffer
      this.resampleOutputLengthPointer
    );

    const resampledSamples = this.HEAP32![this.resampleOutputLengthPointer >> 2];
    
    // Encode to Opus
    const encodedBytes = this.wasmInstance.exports.s( // _opus_encode_float
      this.encoder,
      this.decoderOutputPointer,
      resampledSamples,
      this.encoderOutputBufferPointer,
      this.encoderOutputMaxLength
    );

    if (encodedBytes > 0) {
      const packet = this.HEAPU8!.subarray(this.encoderOutputBufferPointer, this.encoderOutputBufferPointer + encodedBytes);
      this.oggGranulePosition += resampledSamples;
      this.sendOggPage(new Uint8Array(packet), 0);
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    // Handle Output (Decoding)
    const output = outputs[0];
    const channel = output[0];
    
    if (this.bufferCount === 0 && this.wasmInstance) {
      // this.log("Buffer underrun - playing silence");
    }

    for (let i = 0; i < channel.length; i++) {
      if (this.bufferCount > 0) {
        channel[i] = this.outputRingBuffer[this.readIndex];
        this.readIndex = (this.readIndex + 1) % this.outputRingBuffer.length;
        this.bufferCount--;
      } else {
        channel[i] = 0;
      }
    }

    // Handle Input (Encoding)
    const input = inputs[0];
    if (input && input[0]) {
      const inputChannel = input[0];
      for (let i = 0; i < inputChannel.length; i++) {
        this.pcmBuffer[this.pcmBufferIndex++] = inputChannel[i];
        if (this.pcmBufferIndex >= this.pcmBuffer.length) {
          this.encodePcm(this.pcmBuffer);
          this.pcmBufferIndex = 0;
        }
      }
    }

    return true;
  }

  private decodeOgg(data: Uint8Array) {
    // Append new data to buffer
    const newBuffer = new Uint8Array(this.dataBuffer.length + data.length);
    newBuffer.set(this.dataBuffer, 0);
    newBuffer.set(data, this.dataBuffer.length);
    this.dataBuffer = newBuffer;

    let offset = 0;
    while (offset <= this.dataBuffer.length - 27) {
      // Search for "OggS"
      if (this.dataBuffer[offset] === 0x4F && this.dataBuffer[offset+1] === 0x67 && 
          this.dataBuffer[offset+2] === 0x67 && this.dataBuffer[offset+3] === 0x53) {
        
        const view = new DataView(this.dataBuffer.buffer, this.dataBuffer.byteOffset + offset, this.dataBuffer.byteLength - offset);
        const segmentCount = view.getUint8(26);
        
        // Check if we have all segment lengths
        if (this.dataBuffer.length < offset + 27 + segmentCount) break;
        
        let pageSize = 27 + segmentCount;
        for (let i = 0; i < segmentCount; i++) {
          pageSize += view.getUint8(27 + i);
        }

        // Check if we have the full page
        if (this.dataBuffer.length < offset + pageSize) break;

        // Process the full page
        this.processOggPage(this.dataBuffer.subarray(offset, offset + pageSize));
        offset += pageSize;
      } else {
        offset++;
      }
    }

    // Keep remaining data
    this.dataBuffer = this.dataBuffer.slice(offset);
  }

  private processOggPage(page: Uint8Array) {
    const view = new DataView(page.buffer, page.byteOffset, page.byteLength);
    const segmentCount = view.getUint8(26);
    let segmentOffset = 27 + segmentCount;

    for (let i = 0; i < segmentCount; i++) {
      const segmentLength = view.getUint8(27 + i);
      const packet = page.subarray(segmentOffset, segmentOffset + segmentLength);
      
      // Copy packet to decoder buffer
      if (this.decoderBufferIndex + packet.length <= this.decoderBuffer!.length) {
        this.decoderBuffer!.set(packet, this.decoderBufferIndex);
        this.decoderBufferIndex += packet.length;
      }
      segmentOffset += segmentLength;

      // If segment length < 255, it's the end of an Opus packet
      if (segmentLength < 255) {
        if (this.decoderBufferIndex > 0) {
          // Skip header packets
          const isHeader = this.decoderBufferIndex >= 8 && (
            (this.decoderBuffer![0] === 0x4F && this.decoderBuffer![1] === 0x70 && this.decoderBuffer![2] === 0x75 && this.decoderBuffer![3] === 0x73 &&
             this.decoderBuffer![4] === 0x48 && this.decoderBuffer![5] === 0x65 && this.decoderBuffer![6] === 0x61 && this.decoderBuffer![7] === 0x64) ||
            (this.decoderBuffer![0] === 0x4F && this.decoderBuffer![1] === 0x70 && this.decoderBuffer![2] === 0x75 && this.decoderBuffer![3] === 0x73 &&
             this.decoderBuffer![4] === 0x54 && this.decoderBuffer![5] === 0x61 && this.decoderBuffer![6] === 0x67 && this.decoderBuffer![7] === 0x73)
          );

          if (!isHeader) {
            const decodedSamples = this.wasmInstance.exports.j( // _opus_decode_float
              this.decoder,
              this.decoderBufferPointer,
              this.decoderBufferIndex,
              this.decoderOutputPointer,
              this.decoderOutputMaxLength,
              0
            );

            if (decodedSamples > 0) {
              const resampledSamples = Math.ceil(decodedSamples * this.config.outputBufferSampleRate / this.config.decoderSampleRate);
              this.HEAP32![this.decoderOutputLengthPointer >> 2] = decodedSamples;
              this.HEAP32![this.resampleOutputLengthPointer >> 2] = resampledSamples;

              this.wasmInstance.exports.n( // _speex_resampler_process_interleaved_float
                this.resampler,
                this.decoderOutputPointer,
                this.decoderOutputLengthPointer,
                this.resampleOutputBufferPointer,
                this.resampleOutputLengthPointer
              );

              const outputData = this.HEAPF32!.subarray(
                this.resampleOutputBufferPointer >> 2,
                (this.resampleOutputBufferPointer >> 2) + resampledSamples * this.config.numberOfChannels
              );

              this.writeToRingBuffer(outputData);
            }
          }
        }
        this.decoderBufferIndex = 0;
      }
    }
  }

  private getPageBoundaries(view: DataView) {
    const boundaries = [];
    for (let i = 0; i < view.byteLength - 4; i++) {
      if (view.getUint32(i, true) === 0x5367674F) { // "OggS"
        boundaries.push(i);
      }
    }
    return boundaries;
  }

  private writeToRingBuffer(data: Float32Array) {
    if (this.bufferCount + data.length > this.outputRingBuffer.length) {
      this.log(`Ring buffer overflow: count=${this.bufferCount}, adding=${data.length}`);
    }
    for (let i = 0; i < data.length; i++) {
      this.outputRingBuffer[this.writeIndex] = data[i];
      this.writeIndex = (this.writeIndex + 1) % this.outputRingBuffer.length;
      if (this.bufferCount < this.outputRingBuffer.length) {
        this.bufferCount++;
      } else {
        // Overflow, move read index
        this.readIndex = (this.readIndex + 1) % this.outputRingBuffer.length;
      }
    }
  }
}

registerProcessor('opus-processor', OpusProcessor);
