// Singapore public holidays for the business-day count (review of 24 Nov 2026, Decision 11). Elena approves this list.
//
// Source: the Ministry of Manpower's published lists.
// - 2024: https://www.mom.gov.sg/newsroom/press-releases/2023/0524-public-holidays-for-2024
// - 2025 to 2027: https://www.mom.gov.sg/employment-practices/public-holidays
// Read on 24 November 2026.
//
// Each holiday as gazetted, plus the following Monday where a holiday falls on a Sunday (MOM: "the following Monday
// will be a public holiday"). A holiday on a Saturday has no day in lieu here (MOM leaves that to the employer), so it
// changes nothing in a Monday-to-Friday count but is listed as published.
//
// Years held: 2024 to the current year plus one. Add each year when MOM publishes it; `SG_PUBLIC_HOLIDAY_YEARS` says
// which years the list covers, and a count reaching outside them says so in its line.

import type { IsoDate } from "../update/contract.ts";

export const SG_PUBLIC_HOLIDAYS_SOURCE = {
  publisher: "Ministry of Manpower",
  urls: [
    "https://www.mom.gov.sg/newsroom/press-releases/2023/0524-public-holidays-for-2024",
    "https://www.mom.gov.sg/employment-practices/public-holidays",
  ],
  readOn: "2026-11-24",
} as const;

export const SG_PUBLIC_HOLIDAY_YEARS = { from: 2024, to: 2027 } as const;

/** `inLieuOf` is set on the Monday after a Sunday holiday. */
export interface SgPublicHoliday {
  date: IsoDate;
  name: string;
  inLieuOf?: IsoDate;
}

export const SG_PUBLIC_HOLIDAYS: readonly SgPublicHoliday[] = [
  // 2024
  { date: "2024-01-01", name: "New Year's Day" },
  { date: "2024-02-10", name: "Chinese New Year" },
  { date: "2024-02-11", name: "Chinese New Year" },
  { date: "2024-02-12", name: "Chinese New Year (Monday in lieu)", inLieuOf: "2024-02-11" },
  { date: "2024-03-29", name: "Good Friday" },
  { date: "2024-04-10", name: "Hari Raya Puasa" },
  { date: "2024-05-01", name: "Labour Day" },
  { date: "2024-05-22", name: "Vesak Day" },
  { date: "2024-06-17", name: "Hari Raya Haji" },
  { date: "2024-08-09", name: "National Day" },
  { date: "2024-10-31", name: "Deepavali" },
  { date: "2024-12-25", name: "Christmas Day" },
  // 2025
  { date: "2025-01-01", name: "New Year's Day" },
  { date: "2025-01-29", name: "Chinese New Year" },
  { date: "2025-01-30", name: "Chinese New Year" },
  { date: "2025-03-31", name: "Hari Raya Puasa" },
  { date: "2025-04-18", name: "Good Friday" },
  { date: "2025-05-01", name: "Labour Day" },
  { date: "2025-05-03", name: "Polling Day" },
  { date: "2025-05-12", name: "Vesak Day" },
  { date: "2025-06-07", name: "Hari Raya Haji" },
  { date: "2025-08-09", name: "National Day" },
  { date: "2025-10-20", name: "Deepavali" },
  { date: "2025-12-25", name: "Christmas Day" },
  // 2026
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-02-17", name: "Chinese New Year" },
  { date: "2026-02-18", name: "Chinese New Year" },
  { date: "2026-03-21", name: "Hari Raya Puasa" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-05-01", name: "Labour Day" },
  { date: "2026-05-27", name: "Hari Raya Haji" },
  { date: "2026-05-31", name: "Vesak Day" },
  { date: "2026-06-01", name: "Vesak Day (Monday in lieu)", inLieuOf: "2026-05-31" },
  { date: "2026-08-09", name: "National Day" },
  { date: "2026-08-10", name: "National Day (Monday in lieu)", inLieuOf: "2026-08-09" },
  { date: "2026-11-08", name: "Deepavali" },
  { date: "2026-11-09", name: "Deepavali (Monday in lieu)", inLieuOf: "2026-11-08" },
  { date: "2026-12-25", name: "Christmas Day" },
  // 2027
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-02-06", name: "Chinese New Year" },
  { date: "2027-02-07", name: "Chinese New Year" },
  { date: "2027-02-08", name: "Chinese New Year (Monday in lieu)", inLieuOf: "2027-02-07" },
  { date: "2027-03-10", name: "Hari Raya Puasa" },
  { date: "2027-03-26", name: "Good Friday" },
  { date: "2027-05-01", name: "Labour Day" },
  { date: "2027-05-17", name: "Hari Raya Haji" },
  { date: "2027-05-20", name: "Vesak Day" },
  { date: "2027-08-09", name: "National Day" },
  { date: "2027-10-28", name: "Deepavali" },
  { date: "2027-12-25", name: "Christmas Day" },
];

export const SG_PUBLIC_HOLIDAY_DATES: ReadonlySet<IsoDate> = new Set(SG_PUBLIC_HOLIDAYS.map((h) => h.date));

/** Whether every date in [from, to] falls in a year the list holds. */
export function sgHolidayListCovers(from: IsoDate, to: IsoDate): boolean {
  const years = [Number(from.slice(0, 4)), Number(to.slice(0, 4))];
  return years.every((y) => y >= SG_PUBLIC_HOLIDAY_YEARS.from && y <= SG_PUBLIC_HOLIDAY_YEARS.to);
}
