import { Decoder, Encoder, Profile as FitProfile, Stream } from '@garmin/fitsdk';
import { ROUTES } from '../routes/definitions';
import { uuid } from '../util/math';
import { summarizeSamples } from '../game/recorder';
import type { RideSample, RideSummary } from './types';

type FitMesg = Parameters<Encoder['onMesg']>[1];

/**
 * Encodes a ride as a FIT activity (virtual ride) that Strava, Garmin Connect,
 * TrainingPeaks and intervals.icu accept.
 */
export function encodeFit(summary: RideSummary, samples: RideSample[]): Uint8Array {
  const start = new Date(summary.startedAt);
  const at = (t: number) => new Date(start.getTime() + t * 1000);
  // Each sample covers one second, so the ride ends one second after the last
  // record. That keeps the end timestamps and totalElapsedTime in agreement.
  const end = at(samples.length ? samples[samples.length - 1].t + 1 : 0);
  const elapsedSec = Math.round((end.getTime() - start.getTime()) / 1000);
  const M = FitProfile.MesgNum;
  const enc = new Encoder();
  const put = (num: number, mesg: Record<string, unknown>) => enc.onMesg(num, mesg as FitMesg);

  put(M.FILE_ID, {
    type: 'activity',
    manufacturer: 'development',
    product: 1,
    timeCreated: start,
    serialNumber: 20261101,
  });
  put(M.DEVICE_INFO, {
    timestamp: start,
    manufacturer: 'development',
    product: 1,
    productName: 'CycleBuddy',
    softwareVersion: 0.1,
    deviceIndex: 'creator',
  });
  put(M.EVENT, { timestamp: start, event: 'timer', eventType: 'start' });

  for (const s of samples) {
    const rec: Record<string, unknown> = {
      timestamp: at(s.t),
      distance: s.distance,
      speed: s.speed,
      enhancedSpeed: s.speed,
      power: Math.round(s.power),
      cadence: Math.round(s.cadence),
      altitude: s.altitude,
      enhancedAltitude: s.altitude,
      grade: s.grade * 100,
    };
    if (s.heartRate > 0) rec.heartRate = Math.round(s.heartRate);
    put(M.RECORD, rec);
  }

  put(M.EVENT, { timestamp: end, event: 'timer', eventType: 'stopAll' });

  const totals = {
    startTime: start,
    totalElapsedTime: elapsedSec,
    totalTimerTime: summary.durationSec,
    totalMovingTime: summary.movingSec,
    totalDistance: summary.distanceM,
    totalAscent: Math.round(summary.ascentM),
    avgSpeed: summary.avgSpeedKmh / 3.6,
    enhancedAvgSpeed: summary.avgSpeedKmh / 3.6,
    avgPower: Math.round(summary.avgPower),
    maxPower: Math.round(summary.maxPower),
    normalizedPower: Math.round(summary.normalizedPower),
    avgCadence: Math.round(summary.avgCadence),
    ...(summary.avgHeartRate > 0 ? { avgHeartRate: Math.round(summary.avgHeartRate), maxHeartRate: Math.round(summary.maxHeartRate) } : {}),
  };

  put(M.LAP, { timestamp: end, messageIndex: 0, event: 'lap', eventType: 'stop', sport: 'cycling', subSport: 'virtualActivity', ...totals });
  put(M.SESSION, {
    timestamp: end,
    messageIndex: 0,
    event: 'session',
    eventType: 'stop',
    sport: 'cycling',
    subSport: 'virtualActivity',
    firstLapIndex: 0,
    numLaps: 1,
    ...totals,
  });
  put(M.ACTIVITY, {
    timestamp: end,
    numSessions: 1,
    type: 'manual',
    event: 'activity',
    eventType: 'stop',
    totalTimerTime: summary.durationSec,
    localTimestamp: Math.round((end.getTime() - end.getTimezoneOffset() * 60000 - 631065600000) / 1000),
  });
  return enc.close();
}

const MAX_RIDE_SEC = 24 * 3600;
/** A longer gap between records is a stop (auto-pause, café), not riding. */
const STOP_GAP_SEC = 5;

/** Reads a FIT activity into a ride. Samples are one per second, matching rides recorded here. */
export function rideFromFit(bytes: Uint8Array, fileName = 'ride.fit'): { summary: RideSummary; samples: RideSample[] } {
  const decoder = new Decoder(Stream.fromByteArray(bytes.slice()));
  if (!decoder.isFIT()) throw new Error('This is not a FIT file.');
  const { messages } = decoder.read();
  const records = (messages.recordMesgs ?? [])
    .map((record) => ({ record, at: record.timestamp instanceof Date ? record.timestamp : null }))
    .filter((row): row is { record: (typeof row)['record']; at: Date } => row.at !== null && !Number.isNaN(row.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!records.length) throw new Error('This FIT file has no ride data.');

  const startMs = records[0].at.getTime();
  const span = Math.round((records[records.length - 1].at.getTime() - startMs) / 1000);
  if (span > MAX_RIDE_SEC) throw new Error('This ride is longer than 24 hours.');

  const points = records.map(({ record, at }) => ({
    sec: (at.getTime() - startMs) / 1000,
    power: finite(record.power),
    cadence: finite(record.cadence),
    heartRate: finite(record.heartRate),
    speed: finite(record.enhancedSpeed ?? record.speed),
    distance: finite(record.distance),
    altitude: finite(record.enhancedAltitude ?? record.altitude),
    grade: finite(record.grade),
  }));

  const samples: RideSample[] = [];
  let index = 0;
  for (let t = 0; t <= span; t++) {
    while (index + 1 < points.length && points[index + 1].sec <= t) index++;
    const left = points[index];
    const right = points[Math.min(index + 1, points.length - 1)];
    const gap = right.sec - left.sec;
    // Inside a long gap the rider was stopped: no power, cadence or speed, and the
    // distance waits for the next record. Heart rate holds.
    if (gap > STOP_GAP_SEC && t > left.sec && t < right.sec) {
      samples.push({
        t,
        power: 0,
        cadence: 0,
        heartRate: Math.round(left.heartRate ?? right.heartRate ?? 0),
        speed: 0,
        distance: +(left.distance ?? right.distance ?? 0).toFixed(1),
        altitude: +(left.altitude ?? right.altitude ?? 0).toFixed(1),
        grade: 0,
      });
      continue;
    }
    const blend = gap > 0.001 ? Math.min(1, Math.max(0, (t - left.sec) / gap)) : 0;
    samples.push({
      t,
      power: Math.round(left.power ?? right.power ?? 0),
      cadence: Math.round(left.cadence ?? right.cadence ?? 0),
      heartRate: Math.round(left.heartRate ?? right.heartRate ?? 0),
      speed: +mix(left.speed, right.speed, blend).toFixed(3),
      distance: +mix(left.distance, right.distance, blend).toFixed(1),
      altitude: +mix(left.altitude, right.altitude, blend).toFixed(1),
      grade: +((left.grade ?? right.grade ?? 0) / 100).toFixed(4),
    });
  }
  fillDistanceFromSpeed(samples);

  const named = fileName.match(/^CycleBuddy_\d{4}-\d{2}-\d{2}_\d{4}_([a-z0-9-]+)\.fit$/i);
  const route = named ? ROUTES.find((item) => item.id === named[1].toLowerCase()) : undefined;
  const summary = summarizeSamples(uuid(), records[0].at, samples, {
    mode: 'free',
    routeId: route?.id ?? 'imported',
    routeName: route?.name ?? 'Imported',
    title: route?.name ?? fitTitle(fileName),
  });
  return { summary, samples };
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mix(left: number | null, right: number | null, blend: number): number {
  if (left == null && right == null) return 0;
  if (left == null) return right as number;
  if (right == null) return left;
  return left + (right - left) * blend;
}

function fillDistanceFromSpeed(samples: RideSample[]): void {
  if (samples.some((sample) => sample.distance > 0)) return;
  let distance = 0;
  for (const sample of samples) {
    distance += sample.speed;
    sample.distance = +distance.toFixed(1);
  }
}

function fitTitle(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  return base || 'Imported ride';
}
