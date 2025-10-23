export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function addHours(date: Date, hours: number): Date {
  const result = new Date(date);
  result.setUTCHours(result.getUTCHours() + hours);
  return result;
}

export function toIsoString(date: Date): string {
  return date.toISOString();
}

export function currentUnixTime(): number {
  return Math.floor(Date.now() / 1000);
}

export function addSeconds(timestamp: number, seconds: number): number {
  return timestamp + seconds;
}
