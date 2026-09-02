import Link from "next/link";
import { notFound } from "next/navigation";
import { getPatientDetail, computeBadges } from "@/lib/data";
import { PhixoLogo } from "@/components/phixo-logo";
import { GoalRing } from "@/components/goal-ring";
import { DailyRepsChart, EffortChart } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PatientHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getPatientDetail(id);
  if (!detail) notFound();
  const { patient, protocol, day, daily, repsToday, totalReps } = detail;
  const badges = computeBadges(detail);
  const firstName = patient.name.split(" ")[0];
  const lastRange = daily.at(-1)?.avgPatientRangePct;
  const firstRange = daily[0]?.avgPatientRangePct;
  const rangeGain =
    lastRange != null && firstRange != null ? Math.round(lastRange - firstRange) : null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between">
        <Link href="/patient">
          <PhixoLogo className="text-xl" />
        </Link>
        <Badge variant="secondary">
          Day {Math.min(day, 7)} of 7 · Bed {patient.bed}
        </Badge>
      </header>

      <section className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-semibold">
          {repsToday === 0 ? `Good morning, ${firstName}!` : `Keep it up, ${firstName}!`}
        </h1>
        <p className="max-w-md text-muted-foreground">
          {repsToday >= protocol.targetRepsPerDay
            ? "You reached today's goal — every extra rep still helps your brain rewire."
            : repsToday === 0
              ? "This week matters most for your recovery. Let's get your first reps in."
              : `${protocol.targetRepsPerDay - repsToday} reps to go — you're on your way.`}
        </p>
        <GoalRing value={repsToday} target={protocol.targetRepsPerDay} size={210} sublabel="today" />
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" className="h-14 px-10 text-lg" asChild>
            <Link href={`/patient/${patient.id}/session`}>
              {repsToday === 0 ? "Start my first session" : "Start a session"}
            </Link>
          </Button>
          <Button size="lg" variant="outline" className="h-14 px-8 text-lg" asChild>
            <Link href={`/patient/${patient.id}/live`}>Connect physical POC</Link>
          </Button>
        </div>
        {rangeGain != null && rangeGain > 0 ? (
          <p className="text-sm font-medium text-chart-2">
            💪 You are covering {rangeGain} points more of your range since Day 1
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My repetitions by day</CardTitle>
          </CardHeader>
          <CardContent>
            {daily.length > 0 ? (
              <DailyRepsChart daily={daily} target={protocol.targetRepsPerDay} height={210} />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Your progress will appear here after your first session.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My effort vs. Phixo&apos;s help</CardTitle>
          </CardHeader>
          <CardContent>
            {daily.length > 1 ? (
              <EffortChart daily={daily} height={210} />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                After a few days you&apos;ll see the device helping less as you get stronger.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">My milestones</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {badges.map((b) => (
            <div
              key={b.id}
              title={b.description}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border p-3 text-center",
                b.earned ? "bg-accent/50" : "opacity-40 grayscale"
              )}
            >
              <span className="text-2xl" aria-hidden>
                {b.emoji}
              </span>
              <span className="text-xs font-medium">{b.label}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-auto flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
        <span>{totalReps.toLocaleString()} total repetitions since admission</span>
        <span>Ask your physiotherapist before changing exercises</span>
      </footer>
    </main>
  );
}
