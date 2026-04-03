

async function test() {
  console.log('Disabling global fetch for Lyra initialization...');
  // @ts-ignore
  const originalFetch = global.fetch;
  // @ts-ignore
  global.fetch = undefined;

  let Lyra;
  try {
    const LyraModule = await import('lyra-codec');
    Lyra = LyraModule.default;
  } finally {
    // Restore fetch
    // @ts-ignore
    global.fetch = originalFetch;
  }

  console.log('Lyra object:', Object.keys(Lyra));
  console.log('Checking Lyra readiness...');
  
  // Lyra might need some time to load WASM
  let ready = false;
  for (let i = 0; i < 10; i++) {
    if (Lyra.isLyraReady && Lyra.isLyraReady()) {
      ready = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`Waiting... ${i+1}`);
  }

  console.log('Is Lyra Ready?', ready);
  
  if (ready) {
    // Test encoding/decoding
    const sampleRate = 16000;
    const frameSize = 320; // 20ms at 16kHz
    const input = new Int16Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      input[i] = Math.sin(i * 0.1) * 10000;
    }
    
    console.log('Encoding...');
    const encoded = Lyra.encodeWithLyra(input);
    console.log('Encoded size:', encoded.length);
    
    console.log('Decoding...');
    const decoded = Lyra.decodeWithLyra(encoded);
    console.log('Decoded size:', decoded.length);
  }
}

test().catch(console.error);
