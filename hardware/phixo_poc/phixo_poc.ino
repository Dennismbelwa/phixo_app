/*
 * Phixo POC firmware — Arduino UNO R4 WiFi + MPU-9250/MPU-6500
 * ------------------------------------------------------------
 * Measures elbow flexion/extension on the motorised brace and streams it to the
 * Phixo web app over USB serial.
 *
 * WHY NO MAGNETOMETER
 *   Flexion/extension is rotation about a horizontal axis, and gravity already
 *   gives an absolute reference in that plane. A magnetometer would only correct
 *   yaw drift, which we never measure — and the rig has a MOTOR (a moving magnet)
 *   centimetres from the sensor, which would actively corrupt the readings.
 *   So this sketch talks only to the MPU-6500 core register set, which means an
 *   MPU-9250 and an MPU-6500 behave identically here (a 9250 is a 6500 die plus
 *   an AK8963 magnetometer that we simply never initialise).
 *
 * WHY SENSOR FUSION
 *   Accelerometer alone: absolute and drift-free, but the motor's tangential and
 *     centripetal acceleration corrupts it during movement — exactly when we care.
 *   Gyroscope alone:     clean during movement, but integrating rate drifts
 *     without bound over a five-minute, 130-repetition run.
 *   Complementary filter: gyro for the fast movement, accelerometer to pull the
 *     estimate back to gravity truth. At 100 Hz with alpha = 0.98 the time
 *     constant is ~0.49 s, which is well below one repetition.
 *
 * VELOCITY comes straight from the bias-corrected gyro rather than from
 * differentiating the angle: differentiation amplifies noise, and the gyro
 * measures rate directly.
 *
 * WIRING (I2C)
 *   MPU VCC -> 3.3V     MPU GND -> GND
 *   MPU SDA -> SDA(A4)  MPU SCL -> SCL(A5)
 *   MPU AD0 -> GND      (address 0x68; tie high for 0x69 and change MPU_ADDR)
 *
 * MOUNTING
 *   Fix the sensor to the forearm segment with the elbow's flexion axis aligned
 *   to the IMU axis selected by FLEX_AXIS below. If the reading moves the wrong
 *   way or barely changes, send 'R' over serial to dump raw axes and pick again.
 *
 * SERIAL PROTOCOL @ 115200 baud, newline-delimited
 *   out  D,<tMs>,<angleDeg>,<velDegPerSec>,<motor>  telemetry at 50 Hz
 *   out  S,<calibrated>,<gyroBias>,<zeroDeg>,<rate> status / calibration result
 *   out  E,<message>                                error
 *   in   Z  zero at full extension (also captures gyro bias — HOLD STILL)
 *   in   S  start streaming        X  stop streaming
 *   in   P  ping (replies with a status line)
 *   in   R  dump raw axes for 2 s (mounting diagnostic)
 */

#include <Wire.h>

/* ---------------- configuration ---------------- */

#define MPU_ADDR        0x68
#define SAMPLE_HZ       100     // internal fusion rate
#define OUTPUT_DIVIDER  2       // transmit every Nth sample -> 50 Hz
#define ALPHA           0.98f   // complementary filter weight on the gyro
#define CAL_SAMPLES     200     // ~2 s of averaging for zero + gyro bias

/* Assist-as-needed thresholds. The patient leads; the motor takes over only
 * once they have plainly stopped, so that assistance is the exception the app
 * can count rather than the default. */
#define STALL_VEL_DEG_S   8.0f  // below this the limb is not really moving
#define STALL_HOLD_MS     400   // ...and must stay so this long before assisting
#define ASSIST_RELEASE_DEG_S 20.0f // patient moving this fast again -> hand back

/* Axis selection. Default: elbow flexes about the sensor's X axis, and the
 * sagittal plane is spanned by the Y and Z accelerometer axes.
 * If flexion reads backwards, flip ANGLE_SIGN to -1. */
#define FLEX_AXIS_GYRO  gx
#define ACC_NUM         ay      // atan2(ACC_NUM, ACC_DEN)
#define ACC_DEN         az
#define ANGLE_SIGN      1

/* Full-scale ranges: +/-4 g and +/-500 deg/s. Both comfortably exceed rehab
 * movement without wasting resolution. */
const float ACC_SCALE  = 8192.0f;   // LSB per g   at +/-4 g
const float GYRO_SCALE = 65.5f;     // LSB per dps at +/-500 dps

/* ---------------- registers ---------------- */

#define REG_SMPLRT_DIV    0x19
#define REG_CONFIG        0x1A
#define REG_GYRO_CONFIG   0x1B
#define REG_ACCEL_CONFIG  0x1C
#define REG_ACCEL_CONFIG2 0x1D
#define REG_ACCEL_XOUT_H  0x3B
#define REG_PWR_MGMT_1    0x6B
#define REG_WHO_AM_I      0x75

/* ---------------- state ---------------- */

static const unsigned long SAMPLE_US = 1000000UL / SAMPLE_HZ;
unsigned long nextSampleUs = 0;
uint8_t outputCounter = 0;

float theta = 0.0f;        // fused angle in the sensor frame, degrees
float zeroDeg = 0.0f;      // reading at full extension
float gyroBias = 0.0f;     // deg/s, captured while stationary
bool calibrated = false;
bool streaming = true;

/*
 * Assist-as-needed state.
 *
 * motorActive is the ground truth for the assistance number the app reports: it
 * is true for exactly the samples the motor was driving. Because the board is
 * the thing that engages the motor, this is measured rather than inferred, which
 * is why the app can stop reporting assistance as "not measured" once this is
 * live. It is streamed as the fifth field of every D line.
 */
bool motorActive = false;
unsigned long stalledSinceMs = 0;   // 0 = not currently stalled

void setup() {
  Serial.begin(115200);
  // Wait briefly for a host, but never block forever — the rig must still run
  // if it is powered up before the laptop opens the port.
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 3000) { }

  pinMode(LED_BUILTIN, OUTPUT);
  Wire.begin();
  Wire.setClock(400000);

  if (!initIMU()) {
    Serial.println("E,imu_not_found");
    while (true) {                 // fast blink = sensor not responding
      digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
      delay(100);
    }
  }

  // Seed the filter from gravity so it does not have to converge from zero.
  float ax, ay, az, gx, gy, gz;
  readIMU(ax, ay, az, gx, gy, gz);
  theta = accelAngle(ax, ay, az);

  sendStatus();
  nextSampleUs = micros();
}

void loop() {
  handleCommands();

  // Fixed-rate scheduler: a regular dt is what keeps gyro integration honest.
  unsigned long now = micros();
  if ((long)(now - nextSampleUs) < 0) return;
  nextSampleUs += SAMPLE_US;
  // If we ever fall behind (a long serial write), resync instead of spiralling.
  if ((long)(now - nextSampleUs) > (long)SAMPLE_US * 4) nextSampleUs = now + SAMPLE_US;

  float ax, ay, az, gx, gy, gz;
  if (!readIMU(ax, ay, az, gx, gy, gz)) return;

  const float dt = 1.0f / SAMPLE_HZ;
  const float rate = FLEX_AXIS_GYRO - gyroBias;
  theta = ALPHA * (theta + rate * dt) + (1.0f - ALPHA) * accelAngle(ax, ay, az);

  const float angle = ANGLE_SIGN * (theta - zeroDeg);
  updateAssist(angle, ANGLE_SIGN * rate);

  if (streaming && ++outputCounter >= OUTPUT_DIVIDER) {
    outputCounter = 0;
    // Fixed-width, no printf: keeps the write short and predictable.
    Serial.print("D,");
    Serial.print(millis());
    Serial.print(',');
    Serial.print(angle, 2);
    Serial.print(',');
    Serial.print(ANGLE_SIGN * rate, 2);
    Serial.print(',');
    Serial.println(motorActive ? 1 : 0);
    digitalWrite(LED_BUILTIN, (millis() / 250) % 2);
  }
}

/*
 * Decide whether the motor should be assisting, and record it in motorActive.
 *
 * The rule the clinicians asked for: the patient leads, and the motor engages
 * only once they have stopped moving. Assistance is therefore the share of each
 * repetition the patient could not complete alone — which is exactly the number
 * the app plots as the recovery signal.
 *
 * ---------------------------------------------------------------------------
 * NOT YET DRIVING THE MOTOR. This maintains the state and the telemetry only.
 * Before the drive calls below are filled in, this needs, at minimum:
 *
 *   - end-stop limits, so the brace cannot be driven past the patient's range
 *   - a watchdog that cuts drive if the loop stalls or telemetry stops
 *   - a maximum continuous on-time, and a cool-down after it
 *   - a hardware means of stopping it that does not depend on this firmware
 *
 * This actuates a brace strapped to a person's arm. It should not move until
 * those are in place and someone has verified them on the bench.
 * ---------------------------------------------------------------------------
 */
void updateAssist(float angleDeg, float velDegS) {
  (void)angleDeg;  // will gate on the end-stops once limits are defined
  const float speed = fabsf(velDegS);
  const unsigned long now = millis();

  if (motorActive) {
    // Hand back as soon as the patient is clearly driving again.
    if (speed > ASSIST_RELEASE_DEG_S) {
      motorActive = false;
      stalledSinceMs = 0;
      // TODO(motor): stop drive.
    }
    return;
  }

  if (speed < STALL_VEL_DEG_S) {
    if (stalledSinceMs == 0) stalledSinceMs = now;
    if (now - stalledSinceMs >= STALL_HOLD_MS) {
      motorActive = true;
      // TODO(motor): start drive toward the current target end-stop.
    }
  } else {
    stalledSinceMs = 0;
  }
}

/* ---------------- commands ---------------- */

void handleCommands() {
  while (Serial.available()) {
    const char c = Serial.read();
    switch (c) {
      case 'Z': case 'z': calibrate();  break;
      case 'S': case 's': streaming = true;  sendStatus(); break;
      case 'X': case 'x': streaming = false; sendStatus(); break;
      case 'P': case 'p': sendStatus(); break;
      case 'R': case 'r': dumpRawAxes(); break;
      default: break;  // ignore newlines and anything else
    }
  }
}

/*
 * Capture the zero reference AND the gyro bias from one stationary hold.
 * The bias matters more than it sounds: an uncorrected offset of 1 deg/s
 * integrates into roughly 5 degrees of drift over a 130-repetition run.
 */
void calibrate() {
  const bool wasStreaming = streaming;
  streaming = false;

  double accSum = 0.0;
  double gyroSum = 0.0;
  int taken = 0;

  for (int i = 0; i < CAL_SAMPLES; i++) {
    float ax, ay, az, gx, gy, gz;
    if (readIMU(ax, ay, az, gx, gy, gz)) {
      accSum  += accelAngle(ax, ay, az);
      gyroSum += FLEX_AXIS_GYRO;
      taken++;
    }
    delay(1000 / SAMPLE_HZ);
  }

  if (taken < CAL_SAMPLES / 2) {
    Serial.println("E,calibration_failed");
    streaming = wasStreaming;
    return;
  }

  zeroDeg   = accSum / taken;
  gyroBias  = gyroSum / taken;
  theta     = zeroDeg;          // restart the filter at the new reference
  calibrated = true;
  streaming = wasStreaming;
  sendStatus();
}

void sendStatus() {
  Serial.print("S,");
  Serial.print(calibrated ? 1 : 0);
  Serial.print(',');
  Serial.print(gyroBias, 3);
  Serial.print(',');
  Serial.print(zeroDeg, 2);
  Serial.print(',');
  Serial.println(SAMPLE_HZ / OUTPUT_DIVIDER);
}

/* Mounting aid: prints raw axes so the right FLEX_AXIS_GYRO / ACC_NUM / ACC_DEN
 * can be chosen by moving the brace and watching which values respond. */
void dumpRawAxes() {
  const bool wasStreaming = streaming;
  streaming = false;
  for (int i = 0; i < 100; i++) {
    float ax, ay, az, gx, gy, gz;
    if (readIMU(ax, ay, az, gx, gy, gz)) {
      Serial.print("# ax="); Serial.print(ax, 2);
      Serial.print(" ay="); Serial.print(ay, 2);
      Serial.print(" az="); Serial.print(az, 2);
      Serial.print(" gx="); Serial.print(gx, 1);
      Serial.print(" gy="); Serial.print(gy, 1);
      Serial.print(" gz="); Serial.println(gz, 1);
    }
    delay(20);
  }
  streaming = wasStreaming;
}

/* ---------------- IMU ---------------- */

bool initIMU() {
  const uint8_t who = readReg(REG_WHO_AM_I);
  // 0x70 = MPU-6500, 0x71 = MPU-9250. Both expose the same core registers.
  if (who != 0x70 && who != 0x71) return false;

  writeReg(REG_PWR_MGMT_1, 0x80);   // reset
  delay(100);
  writeReg(REG_PWR_MGMT_1, 0x01);   // wake, clock from the X gyro PLL
  delay(10);
  writeReg(REG_CONFIG,        0x03); // gyro DLPF ~41 Hz
  writeReg(REG_GYRO_CONFIG,   0x08); // +/-500 dps
  writeReg(REG_ACCEL_CONFIG,  0x08); // +/-4 g
  writeReg(REG_ACCEL_CONFIG2, 0x03); // accel DLPF ~41 Hz
  writeReg(REG_SMPLRT_DIV,    (1000 / SAMPLE_HZ) - 1);
  delay(10);
  return true;
}

bool readIMU(float &ax, float &ay, float &az, float &gx, float &gy, float &gz) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(REG_ACCEL_XOUT_H);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, 14, true) != 14) return false;

  int16_t rawAx = (Wire.read() << 8) | Wire.read();
  int16_t rawAy = (Wire.read() << 8) | Wire.read();
  int16_t rawAz = (Wire.read() << 8) | Wire.read();
  Wire.read(); Wire.read();                       // temperature, unused
  int16_t rawGx = (Wire.read() << 8) | Wire.read();
  int16_t rawGy = (Wire.read() << 8) | Wire.read();
  int16_t rawGz = (Wire.read() << 8) | Wire.read();

  ax = rawAx / ACC_SCALE;  ay = rawAy / ACC_SCALE;  az = rawAz / ACC_SCALE;
  gx = rawGx / GYRO_SCALE; gy = rawGy / GYRO_SCALE; gz = rawGz / GYRO_SCALE;
  return true;
}

/* Sagittal-plane tilt from gravity. Unused parameters keep one call signature. */
float accelAngle(float ax, float ay, float az) {
  (void)ax;
  return atan2(ACC_NUM, ACC_DEN) * 57.2957795f;
}

void writeReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

uint8_t readReg(uint8_t reg) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return 0xFF;
  if (Wire.requestFrom(MPU_ADDR, 1, true) != 1) return 0xFF;
  return Wire.read();
}
