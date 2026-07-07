/**
 * buildSinks() env-gating: the OTLP trace sink registers only when
 * CORELLIA_OTLP_ENDPOINT is set and the notification sink only when
 * CORELLIA_NOTIFY_WEBHOOK is set; header env vars are parsed leniently (a
 * malformed value disables auth, not the whole sink).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { buildSinks } from '../../src/daemon/config.js';
import { OtlpSink } from '../../src/eventlog/otlp-sink.js';
import { StdoutSink } from '../../src/eventlog/stdout-sink.js';
import { NotificationSink } from '../../src/eventlog/notification-sink.js';

const OTLP_KEYS = [
  'CORELLIA_OTLP_ENDPOINT',
  'CORELLIA_OTLP_HEADERS',
  'CORELLIA_SINK_STDOUT',
  'CORELLIA_NOTIFY_WEBHOOK',
  'CORELLIA_NOTIFY_HEADERS',
] as const;
const SAVED = Object.fromEntries(OTLP_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of OTLP_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

function clear(): void {
  for (const k of OTLP_KEYS) delete process.env[k];
}

describe('buildSinks — OTLP registration', () => {
  it('registers no OTLP sink when CORELLIA_OTLP_ENDPOINT is unset', () => {
    clear();
    expect(buildSinks().some((s) => s instanceof OtlpSink)).toBe(false);
  });

  it('registers the OTLP sink when CORELLIA_OTLP_ENDPOINT is set', () => {
    clear();
    process.env['CORELLIA_OTLP_ENDPOINT'] = 'https://collector.example.com';
    const sinks = buildSinks();
    expect(sinks.some((s) => s instanceof OtlpSink)).toBe(true);
  });

  it('registers both stdout and OTLP sinks when both are enabled', () => {
    clear();
    process.env['CORELLIA_SINK_STDOUT'] = '1';
    process.env['CORELLIA_OTLP_ENDPOINT'] = 'https://collector.example.com';
    const sinks = buildSinks();
    expect(sinks.some((s) => s instanceof StdoutSink)).toBe(true);
    expect(sinks.some((s) => s instanceof OtlpSink)).toBe(true);
  });

  it('tolerates malformed CORELLIA_OTLP_HEADERS — the OTLP sink still registers', () => {
    clear();
    process.env['CORELLIA_OTLP_ENDPOINT'] = 'https://collector.example.com';
    process.env['CORELLIA_OTLP_HEADERS'] = 'not-json';
    expect(buildSinks().some((s) => s instanceof OtlpSink)).toBe(true);
  });

  it('accepts a JSON-object CORELLIA_OTLP_HEADERS', () => {
    clear();
    process.env['CORELLIA_OTLP_ENDPOINT'] = 'https://api.honeycomb.io';
    process.env['CORELLIA_OTLP_HEADERS'] = JSON.stringify({ 'x-honeycomb-team': 'KEY' });
    expect(buildSinks().some((s) => s instanceof OtlpSink)).toBe(true);
  });
});

describe('buildSinks — notification registration', () => {
  it('registers no notification sink when CORELLIA_NOTIFY_WEBHOOK is unset', () => {
    clear();
    expect(buildSinks().some((s) => s instanceof NotificationSink)).toBe(false);
  });

  it('registers the notification sink when CORELLIA_NOTIFY_WEBHOOK is set', () => {
    clear();
    process.env['CORELLIA_NOTIFY_WEBHOOK'] = 'https://hooks.example.com/notify';
    expect(buildSinks().some((s) => s instanceof NotificationSink)).toBe(true);
  });

  it('tolerates malformed CORELLIA_NOTIFY_HEADERS — the notification sink still registers', () => {
    clear();
    process.env['CORELLIA_NOTIFY_WEBHOOK'] = 'https://hooks.example.com/notify';
    process.env['CORELLIA_NOTIFY_HEADERS'] = 'not-json';
    expect(buildSinks().some((s) => s instanceof NotificationSink)).toBe(true);
  });

  it('registers all three sinks when every env var is enabled', () => {
    clear();
    process.env['CORELLIA_SINK_STDOUT'] = '1';
    process.env['CORELLIA_OTLP_ENDPOINT'] = 'https://collector.example.com';
    process.env['CORELLIA_NOTIFY_WEBHOOK'] = 'https://hooks.example.com/notify';
    const sinks = buildSinks();
    expect(sinks.some((s) => s instanceof StdoutSink)).toBe(true);
    expect(sinks.some((s) => s instanceof OtlpSink)).toBe(true);
    expect(sinks.some((s) => s instanceof NotificationSink)).toBe(true);
  });
});
