"use client";

import { useState, useTransition } from "react";
import { updateProtocol } from "@/lib/actions";
import { EXERCISES } from "@/lib/simulator/engine";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

interface ProtocolDialogProps {
  patientId: string;
  initial: {
    exercises: string[];
    targetRepsPerDay: number;
    maxAssistPct: number;
    sessionMinutes: number;
  };
}

export function ProtocolDialog({ patientId, initial }: ProtocolDialogProps) {
  const [open, setOpen] = useState(false);
  const [exercises, setExercises] = useState<string[]>(initial.exercises);
  const [target, setTarget] = useState(initial.targetRepsPerDay);
  const [maxAssist, setMaxAssist] = useState(initial.maxAssistPct);
  const [minutes, setMinutes] = useState(initial.sessionMinutes);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string, on: boolean) =>
    setExercises((prev) => (on ? [...prev, id] : prev.filter((e) => e !== id)));

  const save = () =>
    startTransition(async () => {
      await updateProtocol(patientId, {
        exercises,
        targetRepsPerDay: target,
        maxAssistPct: maxAssist,
        sessionMinutes: minutes,
      });
      setOpen(false);
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Edit protocol</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rehabilitation protocol</DialogTitle>
          <DialogDescription>
            Applied to the bedside device on the next session.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-2">
          <div className="grid gap-2">
            <Label>Exercises</Label>
            {EXERCISES.map((e) => (
              <label key={e.id} className="flex items-center justify-between text-sm">
                <span>
                  {e.name}
                  <span className="ml-2 text-xs text-muted-foreground">{e.limb}</span>
                </span>
                <Switch
                  checked={exercises.includes(e.id)}
                  onCheckedChange={(v) => toggle(e.id, v)}
                />
              </label>
            ))}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="target">Daily repetition target</Label>
            <Input
              id="target"
              type="number"
              min={50}
              max={600}
              step={25}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">NICE guideline: 300–400 reps/day</p>
          </div>
          <div className="grid gap-2">
            <Label>
              Assistance ceiling: <span className="tabular-nums">{maxAssist}%</span>
            </Label>
            <Slider
              value={[maxAssist]}
              min={40}
              max={100}
              step={5}
              onValueChange={([v]) => setMaxAssist(v)}
            />
            <p className="text-xs text-muted-foreground">
              Lower ceiling forces more patient effort; use with caution in severe impairment.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="minutes">Session length (minutes)</Label>
            <Input
              id="minutes"
              type="number"
              min={10}
              max={60}
              step={5}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || exercises.length === 0}>
            {pending ? "Saving…" : "Save protocol"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
