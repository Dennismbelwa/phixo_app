import Link from "next/link";
import { getRoster } from "@/lib/data";
import { PhixoLogo } from "@/components/phixo-logo";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default function PatientPicker() {
  const roster = getRoster().slice().sort((a, b) => a.patient.bed.localeCompare(b.patient.bed));
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between">
        <Link href="/">
          <PhixoLogo className="text-xl" />
        </Link>
        <span className="text-sm text-muted-foreground">Select your bed to begin</span>
      </header>
      <h1 className="text-2xl font-semibold">Who is exercising today?</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {roster.map(({ patient, day, repsToday, targetReps }) => (
          <Link key={patient.id} href={`/patient/${patient.id}`}>
            <Card className="transition-colors hover:border-primary/60 hover:bg-accent/40">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="font-medium">{patient.name}</p>
                  <p className="text-sm text-muted-foreground">Bed {patient.bed}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="secondary">Day {Math.min(day, 7)} of 7</Badge>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {repsToday}/{targetReps} reps today
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Demo ward — all patients are simulated.
      </p>
    </main>
  );
}
