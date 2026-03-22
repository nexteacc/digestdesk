type TimeZoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatParts(date: Date, timeZone: string): TimeZoneParts {
  const parts = getFormatter(timeZone).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function zonedTimeToUtc(parts: TimeZoneParts, timeZone: string): Date {
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

  for (let i = 0; i < 5; i++) {
    const actual = formatParts(new Date(guess), timeZone);
    const actualUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const targetUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const diff = targetUtc - actualUtc;
    if (diff === 0) {
      break;
    }
    guess += diff;
  }

  return new Date(guess);
}

function parseDateLabel(dateLabel: string) {
  const [year, month, day] = dateLabel.split("-").map(Number);
  return { year, month, day };
}

export function getTimeZoneDateLabel(date: Date, timeZone: string): string {
  const parts = formatParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function getTimeZoneClock(date: Date, timeZone: string) {
  const parts = formatParts(date, timeZone);
  return {
    dateLabel: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    timeLabel: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
  };
}

export function getDayRangeForTimeZone(dateLabel: string, timeZone: string) {
  const start = parseDateLabel(dateLabel);
  const startUtc = zonedTimeToUtc(
    { year: start.year, month: start.month, day: start.day, hour: 0, minute: 0, second: 0 },
    timeZone,
  );

  const nextDay = new Date(Date.UTC(start.year, start.month - 1, start.day + 1, 0, 0, 0));
  const next = {
    year: nextDay.getUTCFullYear(),
    month: nextDay.getUTCMonth() + 1,
    day: nextDay.getUTCDate(),
  };
  const endUtc = zonedTimeToUtc(
    { year: next.year, month: next.month, day: next.day, hour: 0, minute: 0, second: 0 },
    timeZone,
  );

  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
  };
}

export function getPreviousDateLabel(dateLabel: string) {
  const { year, month, day } = parseDateLabel(dateLabel);
  const previousDay = new Date(Date.UTC(year, month - 1, day - 1, 0, 0, 0));
  return `${previousDay.getUTCFullYear()}-${String(previousDay.getUTCMonth() + 1).padStart(2, "0")}-${String(previousDay.getUTCDate()).padStart(2, "0")}`;
}
