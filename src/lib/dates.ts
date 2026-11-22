/** Date helpers. Trip dates are YYYY-MM-DD; activity times are YYYY-MM-DDTHH:mm, both local. */

export function datePart(value: string): string {
  return value.slice(0, 10);
}

export function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function parseLocalDateTime(value: string): Date {
  const [date, time = '00:00'] = value.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

export function formatDate(ymd: string, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!ymd) return '';
  return parseLocalDate(ymd).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...opts,
  });
}

export function formatDayHeading(ymd: string): string {
  return parseLocalDate(ymd).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function formatTime(value: string): string {
  return parseLocalDateTime(value).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDateRange(start: string, end: string): string {
  if (!start) return '';
  if (start === end) return formatDate(start);
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  if (s.getFullYear() === e.getFullYear()) {
    return `${formatDate(start, { year: undefined })} – ${formatDate(end)}`;
  }
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** "Fri, Mar 14 · 7:00 PM – 9:00 PM" or across days. */
export function formatActivityTime(start: string, end: string): string {
  const startDay = parseLocalDate(datePart(start)).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  if (datePart(start) === datePart(end)) {
    return `${startDay} · ${formatTime(start)} – ${formatTime(end)}`;
  }
  const endDay = parseLocalDate(datePart(end)).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${startDay} ${formatTime(start)} – ${endDay} ${formatTime(end)}`;
}

/** Number of calendar days in an inclusive range. */
export function dayCount(start: string, end: string): number {
  const ms = parseLocalDate(end).getTime() - parseLocalDate(start).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface DateRangeError {
  field: string;
  message: string;
}

export function validateTripDates(startDate: string, endDate: string): DateRangeError | null {
  if (!startDate) return { field: 'startDate', message: 'Start date is required.' };
  if (!endDate) return { field: 'endDate', message: 'End date is required.' };
  if (endDate < startDate) return { field: 'endDate', message: 'End date must be on or after the start date.' };
  return null;
}

/** Activities must start and end within the trip's dates, and end after they start. */
export function validateActivityTimes(
  start: string,
  end: string,
  tripStart: string,
  tripEnd: string,
): DateRangeError | null {
  if (!start) return { field: 'start', message: 'Start time is required.' };
  if (!end) return { field: 'end', message: 'End time is required.' };
  const range = `${formatDate(tripStart)} – ${formatDate(tripEnd)}`;
  if (datePart(start) < tripStart || datePart(start) > tripEnd) {
    return { field: 'start', message: `Start must fall within the trip (${range}).` };
  }
  if (datePart(end) < tripStart || datePart(end) > tripEnd) {
    return { field: 'end', message: `End must fall within the trip (${range}).` };
  }
  if (end < start) return { field: 'end', message: 'End must be after the start.' };
  return null;
}

/** Adds (or subtracts) whole days to a YYYY-MM-DD date. */
export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Short "Sat 7:30 PM" label for an activity start. */
export function formatChipTime(value: string): string {
  const d = parseLocalDateTime(value);
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${formatTime(value)}`;
}
