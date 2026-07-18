import Link from "next/link";
import { notFound } from "next/navigation";
import { getPatientDetail } from "@/lib/data";
import { exerciseName, SAFETY_EVENT_LABELS, SafetyEventType } from "@/lib/simulator/engine";
import { PhixoLogo } from "@/components/phixo-logo";
import { DailyRepsChart, EffortChart, QualityChart } from "@/components/charts";
import { ProtocolDialog } from "@/components/protocol-dialog";
import { AckAlertButton } from "@/components/ack-alert-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = getPatientDetail(id);
  if (!detail) notFound();
  const { patient, protocol, day, daily, sessions, alerts, repsToday, totalReps } = detail;
  const openAlerts = alerts.filter((a) => !a.acknowledged);
  const exerciseIds: string[] = JSON.parse(protocol.exercises);
  const latestAssist = daily.at(-1)?.avgAssistPct;
  const firstAssist = daily[0]?.avgAssistPct;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <PhixoLogo className="text-xl" />
          </Link>
          <span className="text-sm text-muted-foreground">
            <Link href="/dashboard" className="hover:underline">
              Ward
            </Link>{" "}
            / {patient.name}
          </span>
        </div>
        <div className="flex gap-2">
          <ProtocolDialog
            patientId={patient.id}
            initial={{
              exercises: exerciseIds,
              targetRepsPerDay: protocol.targetRepsPerDay,
              maxAssistPct: protocol.maxAssistPct,
              sessionMinutes: protocol.sessionMinutes,
            }}
          />
          <Button variant="outline" asChild>
            <Link href={`/dashboard/${patient.id}/report`}>Summary report</Link>
          </Button>
          <Button asChild>
            <Link href={`/patient/${patient.id}`}>Open bedside view</Link>
          </Button>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <h1 className="text-2xl font-semibold">{patient.name}</h1>
        <Badge variant="secondary">Day {Math.min(day, 7)} of 7</Badge>
        <span className="text-sm text-muted-foreground">
          {patient.age} y · {patient.sex} · Bed {patient.bed} · {patient.strokeType} ·{" "}
          {patient.affectedSide} hemiplegia · {patient.severity}
        </span>
      </section>
      {patient.notes ? (
        <p className="rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground">
          {patient.notes}
        </p>
      ) : null}

      {openAlerts.length > 0 ? (
        <Card className="border-destructive/60">
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Open safety alerts ({openAlerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {openAlerts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>
                  ⚠ {SAFETY_EVENT_LABELS[a.type as SafetyEventType] ?? a.type}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {new Date(a.atIso).toLocaleString()} — device auto-paused
                  </span>
                </span>
                <AckAlertButton alertId={a.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Reps today", value: `${repsToday}`, sub: `target ${protocol.targetRepsPerDay}` },
          { label: "Total reps since admission", value: totalReps.toLocaleString(), sub: `${daily.length} active days` },
          {
            label: "Device assistance",
            value: latestAssist != null ? `${Math.round(latestAssist)}%` : "—",
            sub:
              latestAssist != null && firstAssist != null
                ? `${Math.round(firstAssist)}% on first day`
                : "no sessions yet",
          },
          {
            label: "Movement quality",
            value:
              daily.at(-1)?.avgQuality != null ? `${Math.round(daily.at(-1)!.avgQuality!)}/100` : "—",
            sub: "latest day average",
          },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="flex flex-col gap-1 p-5">
              <span className="text-sm text-muted-foreground">{s.label}</span>
              <span className="text-2xl font-semibold tabular-nums">{s.value}</span>
              <span className="text-xs text-muted-foreground">{s.sub}</span>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily repetitions vs. guideline</CardTitle>
          </CardHeader>
          <CardContent>
            <DailyRepsChart daily={daily} target={protocol.targetRepsPerDay} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Recovery signal — patient force vs. device assistance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EffortChart daily={daily} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Movement quality trend</CardTitle>
          </CardHeader>
          <CardContent>
            <QualityChart daily={daily} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent sessions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Exercise</TableHead>
                  <TableHead className="text-right">Reps</TableHead>
                  <TableHead className="text-right">Assist</TableHead>
                  <TableHead className="text-right">Quality</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.slice(0, 8).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm">
                      {new Date(s.startedAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {s.operator === "family" ? (
                        <span className="ml-1 text-xs text-muted-foreground">(family)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">{exerciseName(s.exerciseId)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.repCount}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Math.round(s.avgAssistPct)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Math.round(s.avgQuality)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
