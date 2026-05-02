'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'

export type EmploymentStatus = 'professional' | 'retiree' | 'student' | 'other'

export interface SubmitContactRequestInput {
  case_id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  age: number
  employment_status: EmploymentStatus
  thirty_days_since_last_fi_reply: boolean
  fi_issued_final_response: boolean
  message?: string
}

export interface SubmitContactRequestSuccess {
  ok: true
  id: string
}

export type SubmitContactRequestErrorCode =
  | 'invalid_body'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'server_error'
  | 'unknown'

export class SubmitContactRequestError extends Error {
  status: number
  code: SubmitContactRequestErrorCode
  details?: unknown

  constructor(message: string, status: number, code: SubmitContactRequestErrorCode, details?: unknown) {
    super(message)
    this.name = 'SubmitContactRequestError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function classifyError(status: number, body: Record<string, unknown> | null): SubmitContactRequestError {
  const error = typeof body?.error === 'string' ? body.error : null
  const details = body?.details

  if (status === 400) {
    return new SubmitContactRequestError(
      error ?? 'Your input is invalid. Please check the form and try again.',
      status,
      'invalid_body',
      details,
    )
  }
  if (status === 401) {
    return new SubmitContactRequestError(
      error ?? 'Please sign in again to continue.',
      status,
      'unauthorized',
      details,
    )
  }
  if (status === 403) {
    return new SubmitContactRequestError(
      error ?? 'You do not have permission to submit this case.',
      status,
      'forbidden',
      details,
    )
  }
  if (status === 404) {
    return new SubmitContactRequestError(error ?? 'Case not found.', status, 'not_found', details)
  }
  if (status >= 500) {
    return new SubmitContactRequestError(
      error ?? 'We could not submit your request right now. Please try again shortly.',
      status,
      'server_error',
      details,
    )
  }
  return new SubmitContactRequestError(error ?? 'Failed to submit contact request.', status, 'unknown', details)
}

export function useSubmitContactRequest() {
  const queryClient = useQueryClient()

  return useMutation<SubmitContactRequestSuccess, SubmitContactRequestError, SubmitContactRequestInput>({
    mutationFn: async (payload) => {
      const response = await fetch('/api/contact-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
      if (!response.ok) {
        throw classifyError(response.status, body)
      }

      const ok = body?.ok === true
      const id = typeof body?.id === 'string' ? body.id : null
      if (!ok || !id) {
        throw new SubmitContactRequestError(
          'Contact request response was invalid.',
          response.status,
          'unknown',
          body,
        )
      }

      return { ok: true, id }
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: qk.waitlist(variables.case_id) })
    },
  })
}
