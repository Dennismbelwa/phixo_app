import Link from "next/link";
import { notFound } from "next/navigation";
import { getPatientDetail } from "@/lib/data";
import { EXERCISES } from "@/lib/simulator/engine";
import { LiveSession } from "@/components/device/live-session";
import { PhixoLogo } from "@/components/phixo-logo";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getPatientDetail(id);
  if (!detail) notFound();
  const { patient, protocol } = detail;

  const exerciseIds: string[] = JSON.parse(protocol.exercises);
  const exercises = EXERCISES.filter((e) => exerciseIds.includes(e.id)).map((e) => ({
    id: e.id,
    name: e.name,
  }));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/patient/${patient.id}`}>
          <PhixoLogo className="text-xl" />
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {patient.name} · Bed {patient.bed}
          </span>
          <Badge variant="secondary">Physical POC</Badge>
        </div>
      </header>

      <LiveSession
        patientId={patient.id}
        patientName={patient.name}
        affectedSide={patient.affectedSide}
        // Two different numbers. targetReps is what the rig can actually drive,
        // and ends the session. guidelineReps is the NICE 2023 floor the count is
        // measured against — the gap against 15 reps/day of usual care is the
        // point of showing a denominator at all.
        targetReps={130}
        guidelineReps={300}
        exercises={exercises}
      />

      <p className="text-center text-xs text-muted-foreground">
        Research proof of concept — not for clinical use. Angle, range of motion and velocity are
        measured by the IMU, and the assist-as-needed split from the motor state the firmware
        reports. Movement initiation is not measured: an IMU senses how fast the limb moved, not
        how fast the patient intended to move it.
      </p>
    </main>
  );
}
