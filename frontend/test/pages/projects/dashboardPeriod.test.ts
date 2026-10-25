import { describe, expect, it } from "vitest";
import { resolveCustomPeriod, resolvePreset } from "@/pages/projects/dashboardPeriod";

const NOW = new Date("2026-10-18T10:20:30.123Z");

describe("resolvePreset", () => {
  it("24h : exactement 24 heures avant maintenant, en UTC", () => {
    expect(resolvePreset("24h", NOW)).toEqual({
      from: "2026-10-17T10:20:30.123Z",
      to: "2026-10-18T10:20:30.123Z",
    });
  });

  it("7d et 30d", () => {
    expect(resolvePreset("7d", NOW).from).toBe("2026-10-11T10:20:30.123Z");
    expect(resolvePreset("30d", NOW).from).toBe("2026-09-18T10:20:30.123Z");
  });

  it("rechoisir un preset plus tard donne une nouvelle période", () => {
    const later = new Date(NOW.getTime() + 60_000);
    expect(resolvePreset("24h", later)).not.toEqual(resolvePreset("24h", NOW));
  });

  it("chaque preset est accepté par la validation partagée (90 jours max)", () => {
    for (const preset of ["24h", "7d", "30d"] as const) {
      const { from, to } = resolvePreset(preset, NOW);
      expect(resolveCustomPeriod(from, to).ok).toBe(true);
    }
  });
});

describe("resolveCustomPeriod", () => {
  it("accepte le format de datetime-local (lu comme UTC) et le normalise", () => {
    expect(resolveCustomPeriod("2026-10-01T00:00", "2026-10-02T00:00")).toEqual({
      ok: true,
      period: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" },
    });
  });

  it("accepte un instant UTC complet", () => {
    expect(resolveCustomPeriod("2026-10-01T00:00:00Z", "2026-10-01T12:30:00.5Z")).toMatchObject({
      ok: true,
      period: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-01T12:30:00.500Z" },
    });
  });

  it("refuse from >= to", () => {
    expect(resolveCustomPeriod("2026-10-02T00:00", "2026-10-01T00:00").ok).toBe(false);
    expect(resolveCustomPeriod("2026-10-01T00:00", "2026-10-01T00:00").ok).toBe(false);
  });

  it("accepte exactement 90 jours et refuse plus", () => {
    expect(resolveCustomPeriod("2026-07-01T00:00", "2026-09-29T00:00").ok).toBe(true);
    expect(resolveCustomPeriod("2026-07-01T00:00", "2026-09-29T00:01").ok).toBe(false);
  });

  it("refuse une date invalide ou impossible avec un message, sans la remplacer", () => {
    for (const bad of ["", "hello", "2026-02-31T00:00", "2026-13-01T00:00", "2026-10-05T10:00:00+02:00"]) {
      const result = resolveCustomPeriod(bad, "2026-10-06T00:00");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message.length).toBeGreaterThan(10);
    }
  });
});
