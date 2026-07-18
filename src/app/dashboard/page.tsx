import Link from "next/link";
import { getRoster } from "@/lib/data";
import { PhixoLogo } from "@/components/phixo-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function pctClass(ratio: number): string {
  if (ratio >= 0.8) return "text-chart-2";
  if (ratio >= 0.4) return "text-chart-3";
  return "text-chart-5";
}

export default function Dashboard() {
  const roster = getRoster();
  const totalRepsToday = roster.reduce((s, r) => s + r.repsToday, 0);
  const openAlerts = roster.reduce((s, r) => s + r.openAlerts, 0);
  const onTrack = roster.filter((r) => r.repsToday / r.targetReps >= 0.8).length;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/">
            <PhixoLogo className="text-xl" />
          </Link>
          <span className="text-sm text-muted-foreground">Therapist dashboard · Acute stroke ward</span>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/analytics">Data warehouse</Link>
          </Button>
          <Badge variant="secondary">1 therapist : {roster.length} patients</Badge>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <span className="text-sm text-muted-foreground">Ward repetitions today</span>
            <span className="text-3xl font-semibold tabular-nums">{totalRepsToday.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground">
              ≈ {Math.round(totalRepsToday / 15)} therapist-sessions of manual therapy
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <span className="text-sm text-muted-foreground">Patients on track (≥80% of goal)</span>
            <span className="text-3xl font-semibold tabular-nums">
              {onTrack}/{roster.length}
            </span>
            <span className="text-xs text-muted-foreground">sorted below by who needs attention</span>
          </CardContent>
        </Card>
        <Card className={cn(openAlerts > 0 && "border-destructive/50")}>
          <CardContent className="flex flex-col gap-1 p-5">
            <span className="text-sm text-muted-foreground">Open safety alerts</span>
            <span
              className={cn(
                "text-3xl font-semibold tabular-nums",
                openAlerts > 0 && "text-destructive"
              )}
            >
              {openAlerts}
            </span>
            <span className="text-xs text-muted-foreground">
              {openAlerts > 0 ? "review in patient detail" : "no unreviewed events"}
            </span>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Acute day</TableHead>
                <TableHead>Reps today</TableHead>
                <TableHead className="hidden sm:table-cell">Quality</TableHead>
                <TableHead className="hidden sm:table-cell">Assistance</TableHead>
                <TableHead>Alerts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roster.map((r) => {
                const ratio = r.repsToday / r.targetReps;
                return (
                  <TableRow key={r.patient.id} className="relative">
                    <TableCell>
                      <Link
                        href={`/dashboard/${r.patient.id}`}
                        className="font-medium after:absolute after:inset-0"
                      >
                        {r.patient.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        Bed {r.patient.bed} · {r.patient.strokeType} · {r.patient.affectedSide} side
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.day <= 7 ? "secondary" : "outline"}>
                        Day {Math.min(r.day, 7)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={cn("font-medium tabular-nums", pctClass(ratio))}>
                          {r.repsToday}
                        </span>
                        <span className="text-xs text-muted-foreground">/ {r.targetReps}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            ratio >= 0.8 ? "bg-chart-2" : ratio >= 0.4 ? "bg-chart-3" : "bg-chart-5"
                          )}
                          style={{ width: `${Math.min(100, ratio * 100)}%` }}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">
                      {r.avgQualityToday != null ? `${Math.round(r.avgQualityToday)}/100` : "—"}
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">
                      {r.avgAssistToday != null ? `${Math.round(r.avgAssistToday)}%` : "—"}
                    </TableCell>
                    <TableCell>
                      {r.openAlerts > 0 ? (
                        <Badge variant="destructive">⚠ {r.openAlerts}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Patients are ordered by progress toward today&apos;s goal — lowest first, so the list
        reads as a triage queue.
      </p>
    </main>
  );
}
