# Remote CW keyer review

Reviewed 17 November 2026. The reported symptom is extra elements in both the
local sidetone and transmitted CW when using keyboard paddle input. No Vail
Adapter, radio, or physical key-line capture was available for this review.
The fixes have software timing coverage; they still need station validation.

## Findings and changes

| Finding | Effect | Change |
| --- | --- | --- |
| Keyboard releases were ignored when a text field had focus; no blur release existed. | A paddle could remain logically pressed and repeat elements. | Always process releases; clear local paddles, memory and audio on blur/hidden page. Ignore OS auto-repeat after a release. |
| A blanket `KeyboardEvent.repeat` filter discarded the second Ctrl during a Vail Passthrough squeeze on Windows. | Only the first paddle was active, so holding both produced repeated dits or repeated dahs instead of alternating. | Track physical keyboard codes separately. Accept a new opposite Ctrl even when marked repeat; suppress duplicates and block keys held across focus/mode/connection resets until keyup. |
| Browser only sampled paddles every 4 ms. | Short presses or opposite-paddle taps could disappear between callbacks. | Advance the local keyer immediately on input edges, including touch input. |
| Local audio re-anchored its schedule after each gap. | Timer lateness plus a 2 ms start allowance accumulated across elements, making local sidetone fall behind remote timing. | Preserve the scheduled cadence across ordinary timer lateness. |
| Local state was not fully reset during mode/enable/connection changes. | Old element deadlines or pending memory could survive. | Reset the complete local state and scheduled audio. Sync settings before starting the keyer. |
| Server assumed browser and server connection callbacks shared a clock epoch. | Buffer depth depended on handshake delay and callback timing. | Anchor each claimed sending session to the first received paddle edge, then retain client time intervals. Use a monotonic server clock. |
| Server collapsed all due paddle events into the final state. | Short taps and mode-B opposite-element memory could be lost. | Consume individual edges in timestamp order, advancing the keyer between them. |
| Server discarded events older than 240 ms. | A delayed release could be deleted while its earlier press remained active. | Retain releases even when late. |
| CAT priority queue inserted new commands at the front. | Under load, key-up could overtake key-down, corrupting CW or leaving the last command keyed. | Preserve FIFO order among priority commands, ahead of normal polling. Remove the extra 10 ms queue throttle when priority work is pending. |
| CW polling suppression ended immediately on key-up. | Rig polling could resume in every inter-element gap. | Keep polling suppressed for the existing 500 ms hang time. |
| Claim timeout could expire in an inter-element gap during a held paddle. | Long sending sequences could stop unexpectedly. | Release a claim only when the machine and paddles are idle and the buffer is empty. |
| Output or timing settings could change during an element without stopping it; port/method changes did not reliably reopen the helper. | Old state or the old serial output could remain in use. | Release the old output and reset the sending session on timing/output changes; reopen for port, method or polarity changes. |
| Socket.IO buffers disconnected emits by default. | Obsolete strokes could be replayed on reconnect. | Only emit paddle events while connected. Keep connected events reliable and ordered; dropping a release with volatile delivery would be unsuitable. |

## Iambic behavior

An extra opposite element after releasing a squeeze is intentional in Iambic B.
Iambic A stops after the current element when both paddles have been released
before the next element starts. The new tests distinguish these cases and verify
that a short opposite-paddle tap is remembered in B.

This does not establish exact equivalence to every hardware keyer's paddle-memory
and sampling conventions. The existing A implementation samples paddle levels
at the next element boundary; it does not implement a separate short-tap memory
in A. The existing B implementation captures opposite-element memory during
the sounding element, rather than offering adjustable Curtis/Accu-keyer windows.
These conventions should be compared with the operator's preferred Vail settings.

The application handles keyboard events and touch paddles. There is no MIDI
input implementation in this hook; successful MIDI operation in another keyer
does not exercise this path.

### Vail keyboard input compatibility

The Vail Adapter's published firmware distinguishes raw paddle input from its
internal keyer's output. With an internal keyer selected, keyboard Ctrl edges
are emitted from the generated element output. In Passthrough mode, raw dit/dah
contacts are sent directly instead. The app's iambic modes expect the latter.
Applying another iambic keyer to already timed elements can change spacing,
queue elements, and create repeats when speeds differ. A keyboard event in a
log therefore does not establish when the operator physically touched a paddle.

For this app's current iambic input, select Passthrough in the Vail setup tool,
close MIDI-enabled setup pages, and reconnect the adapter in keyboard mode.
Use the app's local sidetone; the Vail manual says its own paddle sidetone is
silent in Passthrough. Confirm with a held paddle: the host should receive one
keydown followed by one keyup on release, rather than repeated timed strokes.
The adapter's firmware/version and settings should be recorded before concluding
that a particular observed tail is caused by this mismatch. A separate direct
input mode accepting both Ctrl keys would be needed to preserve internally keyed
Vail output without running the app's iambic keyer again.

The operator's subsequent Passthrough recording confirmed a separate application
bug: at 10:26:30.006 the browser delivered ControlRight with `repeat=false`, then
at 10:26:30.016 delivered the first ControlLeft down with `repeat=true`. The old
filter discarded ControlLeft throughout the squeeze. Input tracking now uses
the individual codes, with tests for both press orders, duplicate suppression,
and release/re-arm behavior after blur. The focused CW/rig queue tests pass;
the operator still needs to verify the corrected squeeze with physical paddles.

## Latency budget and remaining limits

The dit duration is `1200 / WPM` milliseconds: 66.7 ms at 18 WPM, 60 ms at
20 WPM, 40 ms at 30 WPM, and 20 ms at 60 WPM.

For the first edge of a session, the station-side software starts approximately
one-way network transit + **60 ms jitter buffer** + timer dispatch lateness after
the client emits. Serial/USB or CAT/radio delay follows. The sidetone is local;
its initial audio envelope starts about 2 ms after handling the press, plus the
audio device's output latency. These are code-derived timings, not measured
end-to-end station latency.

A fixed delay can preserve CW rhythm. Variation in delay is the more serious
problem: if a release arrives after its playback deadline, the server can already
have started another element. No software can retract that transmitted element.
The 60 ms buffer absorbs variation relative to the first event's transit time;
it does not guarantee protection on a connection with larger jitter or a TCP stall.
Do not simply lower it to make CW feel faster. A configurable, measured buffer
would be a useful follow-up.

Both keyers still depend on JavaScript timers. A 4 ms interval is a requested
polling interval, not a timing guarantee. CPU stalls can lengthen physical tones,
shorten later gaps, or bunch overdue output transitions. At 60 WPM, even 4 ms is
20% of a dit. The audio envelopes run on the audio clock once scheduled, but
selecting the next element still runs on the browser's main thread. A browser
worker/AudioWorklet and a station-side native deadline scheduler would reduce
these effects. Neither has been implemented in this change.

CAT PTT remains a weaker timing path: priority cannot interrupt a radio command
already in flight, and each PTT command waits for the rig command pipeline.
The tests mock command completion; they do not measure a radio's response time.
DTR/RTS through a suitable keying interface avoids that CAT queue, although USB,
OS scheduling, and radio key input latency still require measurement.

For a stronger remote design, use one shared keyer implementation for local
feedback and remote scheduling, or send timestamped, completed element
instructions to a station-side scheduler. Keep key-up deadlines and a watchdog
at the station. The current two implementations can still diverge during stalls,
clock drift, settings changes in transit, or events later than the jitter budget.
The existing five-second watchdog monitors a continuously down output, not an
endless sequence of repeating elements from a stale held paddle.

## Station validation

1. Match the app's A/B mode and WPM to the known-good Vail configuration.
   Start with A to distinguish unwanted repetition from B's expected tail.
2. Record local sidetone and station key-line output or radio monitor audio on
   separate channels. Measure both element counts and durations. Constant
   offset alone is not extra keying. Avoid judging timing from a mixture of local
   sidetone and delayed return audio.
3. Test single taps, held dits/dahs, quick opposite-paddle taps, and squeeze
   releases during dits, dahs, and gaps. Include C, K, R, and CQ at the usual WPM.
4. While holding a paddle, focus a text field, switch away, disconnect/reconnect,
   and change keyer mode. Verify the output releases and stale strokes do not
   replay. Hold a single paddle longer than three seconds to check claim handling.
5. Repeat over the intended remote connection and with deliberate load/jitter.
   Compare the existing CAT method with DTR/RTS if that interface is available.
   Configure the radio's key input to accept the externally generated elements;
   feeding them into another iambic keyer can add a second element-generation stage.

Useful follow-up measurements: input event intervals, browser timer lateness,
server event lateness relative to the playhead, rig command turnaround time, and
actual key-line edges. Those measurements would determine whether the 60 ms
buffer is adequate and whether the remaining limitation is browser, network,
USB, or CAT/radio timing.

## Sources

- [K1EL WinKeyer 3.1 manual](https://k1elsystems.com/files/WK3_Datasheet_v1.3.pdf), mode A/B behavior.
- [Vail Adapter firmware](https://github.com/Vail-CW/vail-adapter/blob/master/adapter.cpp), internal keyer output versus raw Passthrough keyboard events.
- [Vail Adapter manual](https://vailadapter.com/manual), Passthrough setup and sidetone behavior.
- [Socket.IO offline behavior](https://socket.io/docs/v4/client-offline-behavior/), disconnected event buffering.
- [MDN setTimeout](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout), timer lateness and throttling.
- [MDN AudioParam.setValueAtTime](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/setValueAtTime), audio-clock scheduling and past-time handling.
