import { z } from "zod"

export function zodEnum<T extends string>(values: readonly T[]): z.ZodType<T> {
  return z.enum(values as [T, ...T[]])
}
