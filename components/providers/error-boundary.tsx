'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { StateMachineErrorCard } from '@/components/state-machine/error-card'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[error-boundary] Unhandled UI error', { error, errorInfo })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="container mx-auto px-4 py-10">
          <StateMachineErrorCard kind="internal" context={this.state.error?.message ?? null} />
        </div>
      )
    }
    return this.props.children
  }
}
