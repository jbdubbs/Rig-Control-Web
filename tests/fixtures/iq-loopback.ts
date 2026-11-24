import { spawn, execSync, type ChildProcess } from 'child_process';

// A second, independent PipeWire loopback for spectrum-iq-panel.spec.ts —
// stereo (2-channel), distinct node name from the mono
// tests/fixtures/audio-loopback.ts loop used by AudioFeedPanel/
// SpectrumAudioPanel/CwDecodePanel. Deliberately duplicated rather than
// parameterizing audio-loopback.ts in place, to avoid risking regressions in
// that file's already-tuned, empirically-discovered behavior.
//
// Topology mirrors audio-loopback.ts, just with 2 channels standing in for
// I/Q: something plays into the capture side (a Sink) — here,
// tests/fixtures/iq-tone-player.ts's own naudiodon output stream, not
// production code — which loops back out the paired ".output" playback side
// (a Source) that server/iqScope.ts's naudiodon capture reads from.
//
// Unlike audio-loopback.ts's mono loop, this one is opened DIRECTLY BY NAME
// rather than via the generic ALSA "pipewire" passthrough device + a
// WirePlumber default-source switch. Confirmed empirically: (1) the direct
// open does NOT hang for this 2-channel node (audio-loopback.ts's own
// comment about a hang was specific to its mono case's PortAudio host API
// interaction, not a general PipeWire property); and (2) sharing the
// generic "pipewire" device between two loopbacks with different channel
// counts, in the same long-lived server process, left the mono loopback's
// own naudiodon capture silently seeing no real signal on every later spec
// in the run — some ALSA/PortAudio-side state outlived this fixture's own
// teardown regardless of how carefully the default-source restore and node
// teardown were polled/confirmed. Opening by name sidesteps the shared
// device entirely, and also means this fixture never touches the host's
// real default audio source at all.
const NODE_NAME = 'rcw_test_iq_loop';
const DESCRIPTION = 'RCW-Test-IQ-Loop';

export const IQ_LOOPBACK_SINK_NAME = NODE_NAME;
export const IQ_LOOPBACK_INPUT_NAME = `${NODE_NAME}.output`;

let child: ChildProcess | null = null;

// A long-lived PipeWire session's pw-dump exceeds execSync's 1 MB default (observed 1.7 MB), which
// throws ENOBUFS. Same limit as audio-loopback.ts.
const PW_DUMP_MAX_BUFFER = 64 * 1024 * 1024;

function findLoopbackSourceNodeId(): string {
  const dump = JSON.parse(execSync('pw-dump', { maxBuffer: PW_DUMP_MAX_BUFFER }).toString()) as Array<{ id: number; info?: { props?: Record<string, unknown> } }>;
  const found = dump.find((obj) => obj.info?.props?.['node.name'] === IQ_LOOPBACK_INPUT_NAME);
  if (!found) throw new Error(`pw-dump: could not find ${IQ_LOOPBACK_INPUT_NAME} node id`);
  return String(found.id);
}

function pollUntil(check: () => boolean, timeoutMs: number, intervalMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      if (check()) { resolve(); return; }
      if (Date.now() >= deadline) { reject(new Error('pollUntil: timed out')); return; }
      setTimeout(attempt, intervalMs);
    }
    attempt();
  });
}

function pollForLoopbackSourceNodeId(timeoutMs = 5000, intervalMs = 100): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      try {
        resolve(findLoopbackSourceNodeId());
      } catch (err) {
        if (Date.now() >= deadline) {
          reject(err);
        } else {
          setTimeout(attempt, intervalMs);
        }
      }
    }
    attempt();
  });
}

export function startIqLoopback(): Promise<void> {
  return new Promise((resolve, reject) => {
    // audio.rate=48000 matches server/iqScope.ts's default iqSampleRate —
    // without a matching rate, PipeWire defaults these nodes to 44100.
    const captureProps = `node.name=${NODE_NAME} node.description=${DESCRIPTION} media.class=Audio/Sink audio.rate=48000`;
    const playbackProps = `node.name=${NODE_NAME}.output node.description=${DESCRIPTION} media.class=Audio/Source audio.rate=48000`;

    // No explicit -m: pw-loopback's channel-map flag expects bracketed
    // syntax ('[ FL, FR ]'), which the mono fixture's short-form '-m MONO'
    // led us to assume also applied here — it doesn't (confirmed empirically:
    // '-m FL,FR' silently creates no nodes at all, no stderr). --channels 2
    // already defaults to '[ FL, FR ]' on its own, so omitting -m entirely
    // gets the same stereo map the simple way.
    const proc = spawn('pw-loopback', [
      '--channels', '2',
      '--capture-props', captureProps,
      '--playback-props', playbackProps,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let settled = false;
    let stderr = '';
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.once('error', (err) => {
      if (!settled) { settled = true; reject(err); }
    });
    proc.once('exit', (code) => {
      if (!settled && code !== 0) {
        settled = true;
        reject(new Error(`pw-loopback exited early (code ${code}): ${stderr}`));
      }
    });
    proc.once('spawn', () => {
      child = proc;
      pollForLoopbackSourceNodeId()
        .then(() => {
          if (!settled) { settled = true; resolve(); }
        })
        .catch((err) => {
          if (!settled) { settled = true; reject(err); }
        });
    });
  });
}

export async function stopIqLoopback(): Promise<void> {
  if (!child) return;
  const proc = child;
  child = null;
  await new Promise<void>((resolve) => {
    proc.once('exit', () => resolve());
    proc.kill('SIGTERM');
    setTimeout(resolve, 2000);
  });

  // Confirm the node is actually gone from the graph before returning —
  // pw-loopback exiting doesn't guarantee PipeWire has finished tearing
  // down its nodes/links yet.
  await pollUntil(() => {
    try {
      const dump = JSON.parse(execSync('pw-dump', { maxBuffer: PW_DUMP_MAX_BUFFER }).toString()) as Array<{ info?: { props?: Record<string, unknown> } }>;
      return !dump.some((obj) => obj.info?.props?.['node.name'] === NODE_NAME || obj.info?.props?.['node.name'] === IQ_LOOPBACK_INPUT_NAME);
    } catch {
      return false;
    }
  }, 2000).catch(() => { /* best-effort */ });
}
