import Link from "next/link";
import { PhixoLogo } from "@/components/phixo-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const STATS = [
  { value: "15", label: "reps/day patients actually receive in acute wards" },
  { value: "300–400", label: "reps/day the NICE 2023 guideline recommends" },
  { value: "12,000+", label: "physiotherapist shortfall making it impossible manually" },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <PhixoLogo className="text-2xl" />
        <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
          Proof of concept · simulated device
        </span>
      </header>

      <section className="flex flex-col items-center gap-6 py-16 text-center">
        <h1 className="max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          The solution for faster stroke recovery
        </h1>
        <p className="max-w-xl text-balance text-lg text-muted-foreground">
          Phixo is a bedside, sensor-triggered assist-as-needed device that lets acute
          stroke patients perform hundreds of guided repetitions in the Day&nbsp;1–7
          window — when the brain is most able to relearn movement.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button size="lg" asChild className="h-12 px-6 text-base">
            <Link href="/patient">Patient bedside mode</Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="h-12 px-6 text-base">
            <Link href="/dashboard">Therapist dashboard</Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {STATS.map((s) => (
          <Card key={s.value}>
            <CardContent className="flex flex-col gap-1 p-6">
              <span className="text-3xl font-semibold tabular-nums text-primary">{s.value}</span>
              <span className="text-sm text-muted-foreground">{s.label}</span>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            step: "1",
            title: "Intent detection",
            body: "Surface EMG, force and IMU sensors pick up the patient's attempt to move — even when no visible motion is produced.",
          },
          {
            step: "2",
            title: "Deficit calculation",
            body: "The software compares intended motion to actual output and computes exactly what's missing.",
          },
          {
            step: "3",
            title: "Assist as needed",
            body: "Motors inject only the missing torque, guiding the limb through its full range — the patient stays in charge.",
          },
          {
            step: "4",
            title: "Log & adapt",
            body: "Every repetition is logged. Assistance thresholds adapt to recovery and fatigue; therapists supervise many patients at once.",
          },
        ].map((f) => (
          <Card key={f.step}>
            <CardContent className="flex flex-col gap-2 p-6">
              <span className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                {f.step}
              </span>
              <h3 className="font-medium">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.body}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <footer className="mt-auto border-t pt-6 text-center text-xs text-muted-foreground">
        Phixo POC · MBA in Healthcare Innovation practicum, Group 7 · All patient data is
        simulated demo data
      </footer>
    </main>
  );
}
