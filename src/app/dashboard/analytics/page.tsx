import Link from "next/link";
import { getWardAnalytics } from "@/lib/data";
import { PhixoLogo } from "@/components/phixo-logo";
import { WardRepsChart, AssistDistributionChart } from "@/components/ward-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function AnalyticsPage() {
  const a = getWardAnalytics();

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
            / Data warehouse
          </span>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Back to roster</Link>
        </Button>
      </header>

      <section className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Ward data warehouse</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every repetition is logged with its sensor signature. This dataset — captured in
          the most clinically critical week of recovery — compounds with every session and
          powers protocol tuning, research, and future predictive-recovery models.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Repetitions captured",
            value: a.totalReps.toLocaleString(),
            sub: `${a.totalSessions} sessions · ${a.totalPatients} patients`,
          },
          {
            label: "Sensor data points",
            value: a.dataPoints.toLocaleString(),
            sub: "angle · range · velocity · assist · quality · timing",
          },
          {
            label: "Therapist time multiplied",
            value: `${a.therapistSessionsEquivalent.toLocaleString()}×`,
            sub: "manual 15-rep sessions replaced",
          },
          {
            label: "Guardrail interventions",
            value: a.safetyEvents.toLocaleString(),
            sub: "auto-paused, zero staff escalations required",
          },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="flex flex-col gap-1 p-5">
              <span className="text-sm text-muted-foreground">{s.label}</span>
              <span className="text-3xl font-semibold tabular-nums text-primary">{s.value}</span>
              <span className="text-xs text-muted-foreground">{s.sub}</span>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ward repetitions delivered per day</CardTitle>
          </CardHeader>
          <CardContent>
            <WardRepsChart data={a.wardDaily} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Ward recovery curve — average device assistance by acute day
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AssistDistributionChart data={a.assistByAcuteDay} />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where this data goes next</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {[
            {
              tag: "Live",
              title: "Protocol tuning",
              body: "Assistance ceilings and rep targets adjusted per patient from observed range and fatigue curves.",
            },
            {
              tag: "Year 6+",
              title: "AI Companion",
              body: "Personalized pacing, gamification, and predictive recovery analytics trained on the repetition corpus.",
            },
            {
              tag: "Year 10+",
              title: "Research Open API",
              body: "Aggregated, anonymised outcome data licensed to academic and pharma partners.",
            },
          ].map((c) => (
            <div key={c.title} className="flex flex-col gap-1 rounded-lg border p-4">
              <Badge variant="secondary" className="w-fit">{c.tag}</Badge>
              <p className="mt-1 font-medium">{c.title}</p>
              <p className="text-sm text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Demo ward — all figures derived from simulated session data.
      </p>
    </main>
  );
}
