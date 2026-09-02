import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getDeviceSessionDetail, getLimbComparison } from "@/lib/data";
import { exerciseName } from "@/lib/simulator/engine";
import { NORMATIVE_ELBOW_ROM_DEG } from "@/lib/device/metrics";
import { AngleTraceChart, RomPerRepChart, VelocityPerRepChart } from "@/components/device/session-charts";
import { RepTable } from "@/components/device/rep-table";
import { PrintButton } from "@/components/print-button";
import { PhixoLogo } from "@/components/phixo-logo";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const deg = (v: number) => `${Math.round(v) || 0}°`;

function Stat({
  label, value, sub, accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 font-mono text-2xl font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>
          {value}
        </p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * Post-session analysis of an instrumented run. Every figure here is derived
 * from the measured angle trace stored during the session.
 */
export default async function DeviceSessionPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const detail = getDeviceSessionDetail(sessionId);
  if (!detail || detail.session.patientId !== id) notFound();

  const { session, patient, reps, metrics, trace, totalSamples, measuredRateHz } = detail;
  const comparison = getLimbComparison(id);
  const started = new Date(session.startedAt);
  const fatiguing = metrics.fatigueIndexDegPerRep < -0.02;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/dashboard/${id}`} className="flex items-center gap-3">
          <PhixoLogo className="text-xl" />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/${id}`}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Back to patient
          </Link>
          <PrintButton />
        </div>
      </header>

      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Session summary</h1>
          <p className="text-sm text-muted-foreground">
            {patient.name} · Bed {patient.bed} · {exerciseName(session.exerciseId)} ·{" "}
            {started.toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-[var(--chart-2)]/40 text-[var(--chart-2)]">
            Physical POC · measured
          </Badge>
          <Badge variant="secondary">
            {session.limb === "unaffected" ? "Unaffected limb" : `Affected limb (${patient.affectedSide})`}
          </Badge>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Repetitions" value={`${metrics.repCount}`} sub="Detected from signal" accent="var(--chart-1)" />
        <Stat
          label="Total ROM"
          value={deg(metrics.totalRomDeg)}
          sub={`${metrics.romCompletenessPct.toFixed(0)}% of ${NORMATIVE_ELBOW_ROM_DEG}° normal`}
          accent="var(--chart-2)"
        />
        <Stat label="Max flexion" value={deg(metrics.maxFlexionDeg)} sub={`mean ${deg(metrics.meanRomDeg)} per rep`} />
        <Stat
          label="Extension deficit"
          value={deg(metrics.extensionDeficitDeg)}
          sub={metrics.extensionDeficitDeg > 10 ? "Monitor for contracture" : "Full extension reached"}
        />
        <Stat
          label="Consistency"
          value={`${metrics.consistency.toFixed(0)}%`}
          sub={`CV ${metrics.cvRomPct.toFixed(1)}% · SD ${metrics.sdRomDeg.toFixed(1)}°`}
          accent="var(--chart-4)"
        />
        <Stat label="Mean quality" value={`${metrics.meanQuality.toFixed(0)}%`} sub={`smoothness ${metrics.meanSmoothness.toFixed(0)}%`} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Elbow angle over the session</CardTitle>
          <p className="text-xs text-muted-foreground">
            {totalSamples.toLocaleString()} samples recorded at {measuredRateHz} Hz
            {trace.length < totalSamples && ` · thinned to ${trace.length.toLocaleString()} points for display`}
          </p>
        </CardHeader>
        <CardContent>
          <AngleTraceChart trace={trace} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Range of motion per repetition</CardTitle>
            <p className="text-xs text-muted-foreground">
              {fatiguing
                ? `Declining ${Math.abs(metrics.fatigueIndexDegPerRep).toFixed(2)}° per rep — ${metrics.romDecayPct.toFixed(1)}% across the session`
                : `Held steady across the session (${metrics.romDecayPct >= 0 ? "+" : ""}${metrics.romDecayPct.toFixed(1)}%)`}
            </p>
          </CardHeader>
          <CardContent>
            <RomPerRepChart reps={reps} meanRomDeg={metrics.meanRomDeg} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Peak angular velocity per repetition</CardTitle>
            <p className="text-xs text-muted-foreground">
              Mean {metrics.meanPeakVelocityDegS.toFixed(0)}°/s · cadence{" "}
              {metrics.cadenceRepsPerMin.toFixed(1)} reps/min
            </p>
          </CardHeader>
          <CardContent>
            <VelocityPerRepChart reps={reps} />
          </CardContent>
        </Card>
      </div>

      {comparison.symmetryIndex != null && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Affected vs unaffected limb</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-8">
            <div>
              <p className="font-mono text-3xl font-semibold" style={{ color: "var(--chart-1)" }}>
                {comparison.symmetryIndex.toFixed(0)}%
              </p>
              <p className="text-xs text-muted-foreground">Limb symmetry index</p>
            </div>
            <div className="text-sm">
              <p>Affected: <span className="font-mono">{deg(comparison.affected?.totalRomDeg ?? 0)}</span> ROM</p>
              <p>Unaffected: <span className="font-mono">{deg(comparison.unaffected?.totalRomDeg ?? 0)}</span> ROM</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Repetition detail</CardTitle>
        </CardHeader>
        <CardContent>
          <RepTable reps={reps} />
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Research proof of concept — not for clinical use. Angle, range of motion and velocity are
        measured by the IMU on the physical rig, and the assist-as-needed split from the motor
        state the firmware reports. Movement initiation is not measured: an IMU senses how fast
        the limb moved, not how fast the patient intended to move it.
      </p>
    </main>
  );
}
