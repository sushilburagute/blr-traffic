import type { SimStats } from '@/sim/types';
import { cohortLabel } from './colors';
export function verdicts(stats: SimStats, comparison?: SimStats): string[] {
  const statements: string[] = [];
  const user = stats.cohorts.find((c) => c.cohort === stats.config.userCohort);
  if (!user) return statements;
  const [type] = user.cohort.split(':');
  const disciplined = stats.cohorts.find((c) => c.cohort === `${type}:disciplined`),
    aggressive = stats.cohorts.find((c) => c.cohort === `${type}:aggressive`);
  if (
    disciplined &&
    aggressive &&
    disciplined.endToEndTrips >= 5 &&
    aggressive.endToEndTrips >= 5 &&
    disciplined.meanTravelTimeS &&
    aggressive.meanTravelTimeS
  ) {
    const delta = disciplined.meanTravelTimeS - aggressive.meanTravelTimeS;
    if (Math.abs(delta) / disciplined.meanTravelTimeS > 0.05)
      statements.push(
        `Lane cutters in ${type === 'twoWheeler' ? 'the two-wheeler' : `the ${type}`} cohort ${delta > 0 ? 'finished' : 'took'} ${(Math.abs(delta) / 60).toFixed(1)} minutes ${delta > 0 ? 'sooner' : 'longer'} than lane followers on completed end-to-end trips (${aggressive.endToEndTrips} versus ${disciplined.endToEndTrips} samples).`,
      );
    if (
      disciplined.hardBrakesPerTrip > 0 &&
      aggressive.hardBrakesPerTrip / disciplined.hardBrakesPerTrip > 1.05
    )
      statements.push(
        `Lane cutters recorded ${(aggressive.hardBrakesPerTrip / disciplined.hardBrakesPerTrip).toFixed(1)}× as many hard-braking episodes per completed trip as lane followers. This is a model proxy, not measured crash risk.`,
      );
  }
  if (user.endToEndTrips < 5)
    statements.push(
      `${cohortLabel(user.cohort)} had ${user.endToEndTrips} completed end-to-end trips. Run longer before drawing a travel-time comparison.`,
    );
  if (comparison) {
    const base = stats.speedSeries.values,
      other = comparison.speedSeries.values;
    const a = base.reduce((s, v) => s + v, 0) / Math.max(1, base.length),
      b = other.reduce((s, v) => s + v, 0) / Math.max(1, other.length);
    if (a > 0 && Math.abs(b - a) / a > 0.05)
      statements.push(
        `The comparison scenario ${b > a ? 'raised' : 'lowered'} the mean of minute-by-minute corridor speeds by ${((Math.abs(b - a) / a) * 100).toFixed(1)}% (${a.toFixed(1)} → ${b.toFixed(1)} km/h), using the same seed.`,
      );
  }
  if (!statements.length)
    statements.push(
      'No cohort travel-time difference cleared the 5% threshold with at least five completed trips per group. Try another scenario or a longer run.',
    );
  return statements;
}
