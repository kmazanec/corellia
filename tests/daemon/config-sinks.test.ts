/**
 * buildSinks() env-gating: the OTLP trace sink registers only when
 * CORELLIA_OTLP_ENDPOINT is set, and CORELLIA_OTLP_HEADERS is parsed leniently
 * (a malformed value disables auth, not the whole sink).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { buildSinks } from '../../src/daemon/config.js';
import { OtlpSink } from '../../src/eventlog/otlp-sink.js';
import { StdoutSink } from '../../src/eventlog/stdout-sink.js';

const OTLP_KEYS = ['CORELLIA_OTLP_ENDPOINT', 'CORELLIA_OTLP_HEADERS', 'CORELLIA_SINK_STDOUT'] as const;
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
