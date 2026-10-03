export const GRACE_MIN = 15;

/** First 15 minutes free, then billed per started hour. Prepaid reservation hours are netted off. */
export function computeFee(durationMin: number, ratePerHour: number, prepaidHours = 0) {
  if (durationMin <= GRACE_MIN) return { billableHours: 0, fee: 0 };
  const hours = Math.ceil(durationMin / 60);
  const billableHours = Math.max(0, hours - prepaidHours);
  return { billableHours, fee: billableHours * ratePerHour };
}
