/**
 * Price Spine Occupancy Calculation
 *
 * Pure function to calculate occupied rooms for a given date.
 * Used by: app/api/cron/price-spine/route.ts
 * Tested by: tests/price-spine-occupancy.test.js
 */

/**
 * Calculate total occupied rooms for a single date.
 *
 * @param windows Array of bid occupancy windows { ci, co, numRooms }
 * @param dateMs Date in milliseconds (checked as [ci, co) interval)
 * @returns SUM(bid.numRooms) for all bids overlapping the date
 *
 * A bid overlaps [date, date+1) if: bid.checkIn <= date AND date < bid.checkOut
 */
export function calculateOccupancyForDate(
  windows: Array<{ ci: number; co: number; numRooms: number }>,
  dateMs: number
): number {
  let occupied = 0;
  for (const w of windows) {
    if (w.ci <= dateMs && dateMs < w.co) {
      occupied += w.numRooms;
    }
  }
  return occupied;
}
