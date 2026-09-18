import { describe, it, expect, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
vi.mock('./client', () => ({ client: {}, deviceId: 'test-device' }));
import { prepareCommand, serviceError } from './api';
import {
  age,
  availableSlots,
  clinicToday,
  dayRange,
  detectMime,
  localToUtc,
  normalizePhone,
  patientPayload,
  type Appointment,
  type Patient,
} from './domain';
describe('clinic local time', () => {
  it('uses Cairo rather than the browser day', () => {
    expect(clinicToday('Africa/Cairo', Temporal.Instant.from('2026-09-18T22:30:00Z'))).toBe(
      '2026-09-19',
    );
  });
  it('preserves a short daylight-saving day', () => {
    const range = dayRange('2026-04-24', 'Africa/Cairo');
    expect((Date.parse(range.to) - Date.parse(range.from)) / 3600000).toBe(23);
  });
  it('rejects times skipped by daylight saving', () => {
    expect(() => localToUtc('2026-04-24', '00:30', 'Africa/Cairo')).toThrow();
  });
  it('does not count a birthday before its date', () => {
    expect(age('2000-09-19', '2026-09-18')).toBe(25);
  });
});
describe('appointment suggestions', () => {
  const appointment = {
    id: 'one',
    starts_at: '2026-09-21T06:30:00Z',
    duration_minutes: 30,
    status: 'scheduled',
  } as Appointment;
  it('excludes overlap and breaks while accepting adjacent slots', () => {
    const slots = availableSlots(
      '2026-09-21',
      'Africa/Cairo',
      30,
      [
        { weekday: 1, start: 540, end: 600 },
        { weekday: 1, start: 660, end: 720 },
      ],
      true,
      [appointment],
      0,
    );
    expect(slots).toEqual(['09:00', '11:00', '11:15', '11:30']);
  });
  it('keeps explicitly closed days closed', () => {
    expect(
      availableSlots(
        '2026-09-22',
        'Africa/Cairo',
        30,
        [{ weekday: 1, start: 540, end: 600 }],
        true,
        [],
        0,
      ),
    ).toEqual([]);
  });
  it('does not block cancelled slots', () => {
    expect(
      availableSlots(
        '2026-09-21',
        'Africa/Cairo',
        30,
        [{ weekday: 1, start: 540, end: 600 }],
        true,
        [{ ...appointment, status: 'cancelled' }],
        0,
      ),
    ).toContain('09:30');
  });
});
describe('write boundaries', () => {
  it('preserves existing alerts in assistant demographic changes', () => {
    const payload = patientPayload(
      {
        full_name: '  Test patient  ',
        mobile: '٠١٠ ١٢٣٤٥٦٧٨',
        alerts: 'Retain the server alert',
        notes: 'Desk note',
        version: 1,
      } as Patient,
      false,
    );
    expect(payload.alerts).toBe('Retain the server alert');
    expect(payload.mobile).toBe('01012345678');
    expect(payload.full_name).toBe('Test patient');
  });
  it('normalizes both Arabic digit sets', () => {
    expect(normalizePhone('+٢٠ (۰۱۰) 123')).toBe('20010123');
  });
  it('freezes the action payload and expiry for a retry', () => {
    const input = { status: 'waiting', nested: { value: 1 } };
    const cmd = prepareCommand('clinic', 'appointment', 'a', 'status', input, 4);
    input.nested.value = 2;
    expect(cmd.p_payload.nested).toEqual({ value: 1 });
    expect(cmd.p_operation_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(Date.parse(String(cmd.p_payload._expires_at)) - Date.now()).toBeGreaterThan(59000);
    expect(cmd.p_expected_version).toBe(4);
  });
  it('treats a version conflict as rejected, not a transient retry', () => {
    expect(serviceError({ code: 'P0001', message: 'VERSION_CONFLICT' })).toMatchObject({
      conflict: true,
      uncertain: false,
    });
  });
  it('does not reveal raw database errors', () => {
    expect(
      serviceError({ code: '23514', message: 'sensitive patient text' }).message,
    ).not.toContain('sensitive');
  });
  it('identifies a lost response as uncertain', () => {
    expect(serviceError(new TypeError('Failed to fetch')).uncertain).toBe(true);
  });
});
describe('document signatures', () => {
  it('rejects a renamed executable', () =>
    expect(() => detectMime(new Uint8Array([77, 90, 0, 0]))).toThrow());
  it('detects PDF and PNG from bytes', () => {
    expect(detectMime(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf');
    expect(detectMime(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBe('image/png');
  });
});
