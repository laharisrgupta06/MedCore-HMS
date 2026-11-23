import {
  hhmmToTime,
  localDate,
  minutesToHhmm,
  timeToMinutes,
  weekdayOf,
  zonedToUtc,
} from './zoned';

describe('hospital-local time', () => {
  it('converts Asia/Kolkata wall time to UTC (UTC+5:30, no DST)', () => {
    expect(zonedToUtc('2031-01-15', 9 * 60, 'Asia/Kolkata').toISOString()).toBe(
      '2031-01-15T03:30:00.000Z',
    );
    expect(localDate(new Date('2031-01-15T20:00:00Z'), 'Asia/Kolkata')).toBe('2031-01-16');
  });
  it('handles a daylight-saving zone', () => {
    expect(zonedToUtc('2031-07-01', 9 * 60, 'Europe/London').toISOString()).toBe(
      '2031-07-01T08:00:00.000Z',
    );
    expect(zonedToUtc('2031-01-01', 9 * 60, 'Europe/London').toISOString()).toBe(
      '2031-01-01T09:00:00.000Z',
    );
  });
  it('weekday, time columns and formatting', () => {
    expect(weekdayOf('2031-01-15')).toBe('WEDNESDAY');
    expect(timeToMinutes(hhmmToTime('13:45'))).toBe(825);
    expect(minutesToHhmm(825)).toBe('13:45');
  });
});
