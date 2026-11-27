# src/ble: trainers and heart rate over Web Bluetooth

## What lives here
- `devices.ts`: `DeviceManager`. Pairs and owns the trainer and HR strap, retries the handshake, reconnect loops, ERG and grade writes with throttling, `releaseToFlat`, `resumeControl`, friendly error text.
- `ftms.ts`: `FtmsTrainer`. FTMS service: Indoor Bike Data parsing, control point (Request Control, Start, Set Simulation, Set Target Power), replies as indications, regains control once when refused.
- `fec.ts`: `FecTrainer`. Tacx "FE-C over BLE": ANT+ pages tunnelled through a custom GATT service. Page 0x33 track resistance (grade + crr), 0x31 target power (0.25 W/bit), 0x37 user weight; reads pages 0x10 and 0x19.
- `heartRate.ts`: HR strap (8 and 16 bit values) with reconnect.
- `virtualTrainer.ts`: keyboard "trainer": Arrow Up/Down ±10 W (Shift ±50 W); `holdPower` locks it in ERG.
- `types.ts`: `TrainerConnection` interface, `SimulationParams`, `WriteQueue`.

## Rules
- All GATT writes go through a `WriteQueue`; Web Bluetooth rejects overlapping operations. Control writes use `queue.replace('control', …)` so only the newest grade or target waits; one-off writes (user weight) use `push`.
- ERG and grade are exclusive. While `ergWatts` is set, `updateGrade` sends nothing. `setErgWatts(null)` hands the trainer back to the gradient.
- Pause, finish and leaving a ride call `devices.releaseToFlat()` (`src/game/app.ts`: `showPause`, `finishRide`, `endSession`). It drops ERG and forces 0 % past the throttle, so the rider is never left against a held target or a steep climb. On resume (`App.resume`), `resumeControl()` forgets what was last sent so the next write goes out at once.
- Writes are throttled: grade at most every ~450 ms and only on a change of 0.1 % or more (or every 5 s); ERG at most every 400 ms. The session calls `updateGrade` every physics step; keep it cheap and let the throttle do its job. See `docs/PERFORMANCE.md`.
- Grade sent to the trainer is clamped to -10..+20 %, with crr 0.004 and cw 0.51. ERG is clamped to 0..2000 W.
- No `alert()`; errors go to the pairing UI through the status emitter.

## Common jobs
Support a new trainer quirk:
1. Find where it fails: handshake (`openTrainer`), control (`handleReply` in `ftms.ts`) or data parsing.
2. Add the fix behind the narrowest check (device name or service), like the Tacx rule that tries FE-C before FTMS.
3. Add a protocol test with the real bytes in `protocol.test.ts` or `ftms.test.ts`.

Add a new control (e.g. wind):
1. Add an optional method to `TrainerConnection`, implement it in both `ftms.ts` and `fec.ts`, write through `queue.replace` with its own key if it must not replace grade/ERG.
2. Re-send it after a reconnect in `reconnectLoop`, like user weight and ERG.

## Tests
- `npx vitest run src/ble/protocol.test.ts`: FTMS and FE-C encoding/parsing, HR parsing, `WriteQueue.replace`.
- `npx vitest run src/ble/ftms.test.ts`: control point replies, refusal, regain control once, then replay the last write.
- `npx vitest run src/ble/devices.test.ts`: grade throttle, `releaseToFlat`, ERG re-sent after a pause, one reconnect loop per drop, stale trainer dropped, HR reconnect and give-up.

## Traps
- Chrome on macOS fails with "GATT operation failed for unknown reason" if service discovery starts in the same turn as `connect()`. Keep the `delay(400…)` after connecting, and don't list all services at once.
- Tacx keeps a half-open connection after a failure; every failed attempt disconnects before retrying.
- A disconnect can fire twice; `reconnecting` (a WeakSet) keeps one loop per device. The rider may pair another trainer during a reconnect: check `this.trainer === t` after every await.
- FE-C `setSimulation` sends only grade and crr; `cw` is ignored. FE-C has no control-refused reply, so `onControlError` only fires for FTMS.
- Trainer reconnect: 10 attempts, 1.5 s + 1 s per attempt, then the trainer is dropped with a message.
