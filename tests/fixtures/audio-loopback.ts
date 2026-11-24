import { spawn, execSync, type ChildProcess } from 'child_process';

// PipeWire loopback for AudioFeedPanel/SpectrumAudioPanel/CwDecodePanel e2e
// coverage — gives server/audio.ts's naudiodon a real device to open in a
// hardware-less environment. No PulseAudio server/pactl involved: pw-loopback
// is the same tool wsjtx-bridge.c already spawns in production
// (spawn_pw_loopback, wsjtx-bridge.c:962-989) — this mirrors that exact
// --capture-props/--playback-props shape for a differently-named node.
// `wpctl` (WirePlumber's own CLI, not PulseAudio) makes the loop's source
// the system default source, which is what unblocks the capture side below.
//
// Topology (same as wsjtx-bridge's RX loop): naudiodon's OUTPUT plays into
// the capture side (presented as a Sink), which loops back out the paired
// ".output" playback side (presented as a Source) that naudiodon's INPUT
// reads from.
const NODE_NAME = 'rcw_test_audio_loop';
const DESCRIPTION = 'RCW-Test-Loop';

// Confirmed empirically: naudiodon's PulseAudio host API device `name` is
// PipeWire's `node.name` (the pw-loopback --capture-props/--playback-props
// value), NOT `node.description` — a pw-loopback capture side named
// `rcw_test_audio_loop` (media.class=Audio/Sink, what naudiodon plays INTO)
// shows up as an output-only device by that exact name. Opening it directly
// works fine and instantly.
export const LOOPBACK_OUTPUT_NAME = NODE_NAME;

// The paired playback side (`rcw_test_audio_loop.output`, media.class=
// Audio/Source, what naudiodon should capture FROM) is confirmed
// empirically to hang naudiodon's AudioIO constructor indefinitely (not an
// error, a true hang, reproduced in isolation outside Playwright/naudiodon's
// PulseAudio host API) when targeting it by that name directly — how
// WirePlumber categorizes the node under `wpctl status` (a "Filter" on
// newer WirePlumber 0.5.x, a plain Source on Ubuntu 24.04's older 0.4.17)
// doesn't change this. What DOES work: making it the WirePlumber default
// source, then opening naudiodon's generic ALSA "pipewire" passthrough
// device (present whenever PipeWire's ALSA plugin is installed) instead of
// the named node — a different PortAudio code path that doesn't hit the
// same hang.
export const LOOPBACK_INPUT_NAME = 'pipewire';

let child: ChildProcess | null = null;
let previousDefaultSourceId: string | null = null;

// Parses `wpctl status`'s first "Sources:" section (audio; there's a
// second one further down for video capture devices) and returns the id of
// whichever line is marked with the leading `*` (the current default), or
// null if none is marked.
function getDefaultAudioSourceId(): string | null {
  const status = execSync('wpctl status').toString();
  const sourcesSection = status.split(/├─ Sources:/)[1]?.split(/├─|└─/)[0] ?? '';
  const match = sourcesSection.match(/\*\s+(\d+)\./);
  return match ? match[1] : null;
}

// Looks up the loopback playback node by its structured `pw-dump` (JSON)
// props rather than scraping `wpctl status`'s human-formatted text — the
// latter shows `node.description` for Sinks/Sources on older WirePlumber
// (0.4.x, e.g. Ubuntu 24.04's CI package), not `node.name`, and both
// loopback sides here share the same description, so the two are
// indistinguishable there. Confirmed via a matching ubuntu:24.04 container:
// wpctl status showed both nodes as "RCW-Test-Loop" with no way to tell
// capture from playback by name; pw-dump's node.name property is reliable
// regardless of WirePlumber version/display differences.
function findLoopbackSourceNodeId(): string {
  const dump = JSON.parse(execSync('pw-dump', { maxBuffer: 64 * 1024 * 1024 }).toString()) as Array<{ id: number; info?: { props?: Record<string, unknown> } }>;
  const targetName = `${NODE_NAME}.output`;
  const found = dump.find((obj) => obj.info?.props?.['node.name'] === targetName);
  if (!found) throw new Error(`pw-dump: could not find ${targetName} node id`);
  return String(found.id);
}

// How long pw-loopback takes to register its nodes with PipeWire varies with
// runner load (confirmed flaky on CI: a single fixed post-spawn delay was
// sometimes too short and failed the whole e2e job before any test ran).
// Poll instead of guessing one delay.
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

export function startAudioLoopback(): Promise<void> {
  return new Promise((resolve, reject) => {
    // audio.rate=48000: without it, PipeWire defaults these nodes to 44100,
    // mismatching the 48000 server/audio.ts's naudiodon AudioIO always
    // requests (see startAudio()) — confirmed empirically this makes the
    // difference between the naudiodon output stream actually opening vs.
    // hanging.
    const captureProps = `node.name=${NODE_NAME} node.description=${DESCRIPTION} media.class=Audio/Sink audio.rate=48000`;
    const playbackProps = `node.name=${NODE_NAME}.output node.description=${DESCRIPTION} media.class=Audio/Source audio.rate=48000`;

    // -m (not the long --channel-map) — confirmed via a matching ubuntu:24.04
    // container that the pw-loopback build CI uses (pipewire-bin 1.0.5-1ubuntu3.3)
    // rejects the long form with "unrecognized option '--channel-map'" even
    // though its own --help text lists it, silently preventing the loopback
    // node from ever being created (every previous "wpctl status: could not
    // find ... node id" failure traced back to this — nothing to poll for,
    // pw-loopback never got past its own argument parsing).
    const proc = spawn('pw-loopback', [
      '--channels', '1',
      '-m', 'MONO',
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
        .then((sourceId) => {
          try {
            previousDefaultSourceId = getDefaultAudioSourceId();
            execSync(`wpctl set-default ${sourceId}`);
            if (!settled) { settled = true; resolve(); }
          } catch (err) {
            if (!settled) { settled = true; reject(err); }
          }
        })
        .catch((err) => {
          if (!settled) { settled = true; reject(err); }
        });
    });
  });
}

export function stopAudioLoopback(): Promise<void> {
  return new Promise((resolve) => {
    if (previousDefaultSourceId) {
      try { execSync(`wpctl set-default ${previousDefaultSourceId}`); } catch { /* best-effort */ }
      previousDefaultSourceId = null;
    }
    if (!child) { resolve(); return; }
    const proc = child;
    child = null;
    proc.once('exit', () => resolve());
    proc.kill('SIGTERM');
    // pw-loopback should exit promptly on SIGTERM; don't hang teardown if it doesn't.
    setTimeout(resolve, 2000);
  });
}
