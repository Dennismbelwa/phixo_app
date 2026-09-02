# Phixo physical POC — hardware guide

A motorised elbow brace instrumented with an IMU, streaming measured joint angle
into the Phixo app over USB. Everything the app shows during a POC session is
derived from this signal.

## Bill of materials

| Part | Notes |
|---|---|
| Arduino UNO R4 WiFi | WiFi is unused — the link is USB serial |
| MPU-9250 **or** MPU-6500 | Interchangeable: the firmware uses only the 6500 core registers |
| Motorised elbow brace / cast | Drives ~130 flexion-extension cycles |
| USB-C **data** cable | A charge-only cable is the classic silent failure |

## Wiring (I²C)

| MPU | Arduino |
|---|---|
| VCC | 3.3V |
| GND | GND |
| SDA | SDA (A4) |
| SCL | SCL (A5) |
| AD0 | GND (address `0x68`) |

Mount the sensor on the **forearm** segment with the elbow's flexion axis aligned
to the IMU axis selected by `FLEX_AXIS_GYRO`. One IMU is enough because the rig
holds the upper arm fixed; if the base can shift during a run, add a second IMU
on the upper-arm segment and subtract the two readings.

## Flashing

1. Arduino IDE → Boards Manager → install **Arduino UNO R4 Boards**.
2. Open `phixo_poc/phixo_poc.ino`, select the board and port, upload.
3. Open the Serial Monitor at **115200** and confirm `D,...` lines are streaming.

### Checking the axis mapping

Send `R` in the Serial Monitor and move the brace through its range. Watch which
values respond:

- The **gyro** axis that swings hardest during flexion → `FLEX_AXIS_GYRO`.
- The two **accel** axes that change with elbow position → `ACC_NUM` / `ACC_DEN`.

If the angle counts backwards, flip `ANGLE_SIGN` to `-1`.

## Serial protocol — 115200 baud, newline-delimited

**From the device**

```
D,142300,87.42,61.20,1      telemetry: tMs, angleDeg, velocityDegPerSec, motorActive (50 Hz)
S,1,0.83,12.44,50           status:    calibrated, gyroBias, zeroDeg, rateHz
E,imu_not_found             error
```

`motorActive` is 1 for the samples the motor was driving. The app reads it as the
measured assist-as-needed split; a four-field `D,` line from older firmware still
parses, and assistance is then reported as *not measured* rather than as 0%.

**To the device**

| Char | Effect |
|---|---|
| `Z` | Zero at full extension, and capture gyro bias — the app sends this once per connection |
| `S` | Start streaming |
| `X` | Stop streaming |
| `P` | Ping (replies with a status line) |
| `R` | Dump raw axes for 2 s (mounting diagnostic) |

CSV rather than JSON keeps the write short on the RA4M1 and removes any library
dependency; ~26 bytes per line at 50 Hz is 1.3 kB/s, trivial for USB CDC.

## Signal processing split

| Runs on the Arduino | Runs in the app |
|---|---|
| Accel + gyro fusion at 100 Hz (needs deterministic timing) | Repetition detection |
| Gyro bias correction, zeroing | ROM, velocity, smoothness, quality |
| Decimation to 50 Hz | Consistency, fatigue, symmetry |

The edge does what must be real-time; the platform does the clinical
interpretation. Detection in the app also means it can be re-run over stored
samples and tuned without reflashing.

## Zeroing at full extension

**Hold the brace at its extension end-stop while connecting.** The app sends `Z`
automatically as soon as telemetry proves the link, the board averages for about
two seconds, and the status chip shows *Zeroing at full extension* while it does.
Telemetry pauses during the average — that gap is expected, not a fault.

This app used to skip calibration, on the reasoning that offsets cancel. Half of
that reasoning still holds: repetition detection uses a running envelope with its
threshold at `mid ± hysteresis × amplitude`, so a constant offset shifts `hi`,
`lo` and `mid` together, and ROM is `maxFlexion - maxExtension`, a difference.
**Rep count, ROM, cadence, duration and consistency really are offset-invariant.**

But the *absolute* readings are not, and they are the ones on screen. Without a
zero, MAX FLEXION and MAX EXTENSION read high by however far the sensor sits from
true zero (~24° on this rig), and **EXTENSION DEFICIT — computed as
`max(0, maxExtension)` — reports a contracture that is not there.** The charts
also draw against a fixed 0–150° scale with a 30–130° functional band, which a
raw sensor-frame signal simply does not sit on.

After zeroing, this rig's mechanical 30°–160° arrives as a clinical **0°–130°**:
0° is full extension, and ROM completeness reads against the 145° normative range.

If zeroing fails the board sends `E,calibration_failed`; the run continues, but
treat the absolute tiles as unreferenced.

Velocities still carry the uncorrected gyro bias between zeroings (~1.6 °/s), and
`Z` captures the bias too, so both are handled by the same hold.

## Presentation checklist

- [ ] **Chrome or Edge** — Web Serial is Chromium-only. Verify on the actual laptop.
- [ ] **Brace at the extension end-stop when you press Connect** — the app zeroes
      there, and a zero taken mid-flexion offsets every absolute angle.
- [ ] **Close the Arduino IDE Serial Monitor** — it holds the port exclusively and
      the app cannot open it while the monitor is running.
- [ ] Known-good **data** USB cable.
- [ ] Connect once beforehand so the port is already permitted.
- [ ] Disable OS sleep and USB power management.
- [ ] Capture a full 130-rep run the day before as a fallback — a stored real run
      still demonstrates real measured data if the rig fails.

## What this POC does and does not measure

**Measured:** elbow angle, range of motion, angular velocity, repetition count,
cadence, movement smoothness, consistency, fatigue trend, and — once the motor
drive is live — the assist-as-needed split.

Assistance is measured rather than estimated, and it needs no current sensor. The
patient leads; the firmware engages the motor only after they have stopped moving
(`STALL_VEL_DEG_S` for `STALL_HOLD_MS`), so the board already knows which samples
it drove. It reports that as `motorActive`, and the app turns it into a
per-repetition share. An INA219 on the motor supply would add torque, but torque
is not what the recovery signal plots.

**Not measured:** movement-initiation velocity. An IMU senses how fast the limb
moved, not how fast the patient intended to move it, so that stays at 0.

Sessions recorded against firmware that does not send `motorActive` are flagged
`assistMeasured = 0` and must be shown as *not reported* — never as 0%
assistance, which reads as "the patient needed no help".
