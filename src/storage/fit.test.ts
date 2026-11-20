import { describe, expect, it } from 'vitest';
import { Decoder, Encoder, Profile as FitProfile, Stream } from '@garmin/fitsdk';
import { encodeFit, rideFromFit } from './fit';
import type { RideSample, RideSummary } from './types';

describe('FIT export', () => {
  it('produces a valid activity file that decodes back', () => {
    const samples: RideSample[] = Array.from({ length: 120 }, (_, t) => ({
      t,
      power: 200 + (t % 10),
      cadence: 88,
      heartRate: 140,
      speed: 8.5,
      distance: t * 8.5,
      altitude: 700 + t * 0.6,
      grade: 0.07,
    }));
    const summary: RideSummary = {
      id: 'x', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), startedAt: '2026-11-01T10:00:00.000Z',
      mode: 'free', routeId: 'alpine', routeName: 'Alpe', title: 'Test', durationSec: 119, movingSec: 119,
      distanceM: 1011.5, ascentM: 71, avgPower: 204.5, maxPower: 209, normalizedPower: 205, avgCadence: 88,
      avgHeartRate: 140, maxHeartRate: 140, avgSpeedKmh: 30.6, hasFit: true,
    };
    const bytes = encodeFit(summary, samples);
    const decoder = new Decoder(Stream.fromByteArray(bytes));
    expect(decoder.isFIT()).toBe(true);
    expect(decoder.checkIntegrity()).toBe(true);
    const { messages, errors } = decoder.read();
    expect(errors).toEqual([]);
    expect(messages.recordMesgs!.length).toBe(120);
    expect(messages.recordMesgs![50].power).toBe(200);
    expect(messages.recordMesgs![50].altitude).toBeCloseTo(730, 0);
    expect(messages.sessionMesgs![0].subSport).toBe('virtualActivity');
    expect(messages.sessionMesgs![0].avgPower).toBe(205);
    // Start + elapsed time lands on the session's end timestamp.
    const session = messages.sessionMesgs![0];
    const startMs = (session.startTime as Date).getTime();
    expect(startMs + (session.totalElapsedTime as number) * 1000).toBe((session.timestamp as Date).getTime());
    expect(messages.lapMesgs![0].totalElapsedTime).toBe(120);

    const imported = rideFromFit(bytes, 'CycleBuddy_2026-11-01_1000_alpine.fit');
    expect(imported.summary.routeId).toBe('alpine');
    expect(imported.summary.routeName).toBe('Alpe du Geant');
    expect(imported.summary.durationSec).toBe(120);
    expect(imported.samples[50].power).toBe(200);
    expect(imported.samples[50].heartRate).toBe(140);
    expect(imported.samples[50].grade).toBeCloseTo(0.07, 2);
    expect(imported.samples[50].distance).toBeCloseTo(50 * 8.5, 0);
  });

  it('imports a ride recorded every few seconds', () => {
    const start = new Date('2026-11-02T08:00:00.000Z');
    const enc = new Encoder();
    const put = (num: number, mesg: Record<string, unknown>) => enc.onMesg(num, mesg as never);
    const M = FitProfile.MesgNum;
    put(M.FILE_ID, { type: 'activity', manufacturer: 'development', product: 1, timeCreated: start });
    for (const [sec, power, distance] of [[0, 100, 0], [5, 200, 50], [10, 300, 100]] as const) {
      put(M.RECORD, {
        timestamp: new Date(start.getTime() + sec * 1000),
        power,
        distance,
        speed: 10,
        heartRate: 120,
        cadence: 80,
      });
    }
    const imported = rideFromFit(enc.close(), 'morning.fit');
    expect(imported.samples).toHaveLength(11);
    expect(imported.samples[0].power).toBe(100);
    expect(imported.samples[4].power).toBe(100);
    expect(imported.samples[5].power).toBe(200);
    expect(imported.samples[2].distance).toBeCloseTo(20, 0);
    expect(imported.samples[10].power).toBe(300);
    expect(imported.summary.title).toBe('morning');
    expect(imported.summary.routeId).toBe('imported');
  });

  it('treats a long gap between records as a stop', () => {
    const start = new Date('2026-11-03T08:00:00.000Z');
    const enc = new Encoder();
    const put = (num: number, mesg: Record<string, unknown>) => enc.onMesg(num, mesg as never);
    const M = FitProfile.MesgNum;
    put(M.FILE_ID, { type: 'activity', manufacturer: 'development', product: 1, timeCreated: start });
    for (const [sec, distance] of [[0, 0], [1, 10], [61, 20], [62, 30]] as const) {
      put(M.RECORD, { timestamp: new Date(start.getTime() + sec * 1000), power: 250, distance, speed: 10, heartRate: 130, cadence: 85 });
    }
    const imported = rideFromFit(enc.close(), 'stop.fit');
    expect(imported.samples).toHaveLength(63);
    expect(imported.samples[1].power).toBe(250);
    const stopped = imported.samples[30];
    expect([stopped.power, stopped.cadence, stopped.speed]).toEqual([0, 0, 0]);
    expect(stopped.heartRate).toBe(130);
    expect(stopped.distance).toBe(10);
    expect(imported.samples[61].power).toBe(250);
    expect(imported.summary.movingSec).toBe(4);
  });
});
