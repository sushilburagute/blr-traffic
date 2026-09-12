export const kmh = (mps: number) => mps * 3.6;
export const minutes = (seconds: number | null) =>
  seconds === null ? '—' : `${(seconds / 60).toFixed(1)} min`;
export const number = (value: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
export const clock = (start: string, time: number) => {
  const [h, m] = start.split(':').map(Number),
    t = (h * 60 + m + Math.floor(time / 60)) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
