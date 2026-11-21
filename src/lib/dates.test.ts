import { describe, expect, it } from 'vitest';
import { dayCount, validateActivityTimes, validateTripDates } from './dates';
import { shiftYmd } from './repo';

describe('validateTripDates', () => {
  it('requires both dates and ordering', () => {
    expect(validateTripDates('', '2027-01-02')?.field).toBe('startDate');
    expect(validateTripDates('2027-01-02', '')?.field).toBe('endDate');
    expect(validateTripDates('2027-01-03', '2027-01-02')?.field).toBe('endDate');
    expect(validateTripDates('2027-01-02', '2027-01-02')).toBeNull();
  });
});

describe('validateActivityTimes', () => {
  const ts = '2027-03-10';
  const te = '2027-03-14';
  it('accepts activities inside the trip, including first and last day', () => {
    expect(validateActivityTimes('2027-03-10T00:00', '2027-03-10T01:00', ts, te)).toBeNull();
    expect(validateActivityTimes('2027-03-14T22:00', '2027-03-14T23:59', ts, te)).toBeNull();
  });
  it('rejects starts or ends outside the trip', () => {
    expect(validateActivityTimes('2027-03-09T23:00', '2027-03-10T01:00', ts, te)?.field).toBe('start');
    expect(validateActivityTimes('2027-03-14T22:00', '2027-03-15T01:00', ts, te)?.field).toBe('end');
  });
  it('rejects end before start', () => {
    expect(validateActivityTimes('2027-03-11T12:00', '2027-03-11T11:00', ts, te)?.field).toBe('end');
  });
});

describe('date helpers', () => {
  it('counts days inclusively and shifts across months', () => {
    expect(dayCount('2027-03-10', '2027-03-14')).toBe(5);
    expect(shiftYmd('2027-01-30', 3)).toBe('2027-02-02');
    expect(shiftYmd('2027-03-01', -1)).toBe('2027-02-28');
  });
});
