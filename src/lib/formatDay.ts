/** `12 Oct 2026`: unambiguous in every locale (a bare `10/12/2026` is read differently in the US and India). */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
