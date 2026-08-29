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
          <div className="space-y-4">
            <StateMachineErrorCard kind="internal" context={this.state.error?.message ?? null} />
            <button className="min-h-11 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground" onClick={() => this.setState({ hasError: false, error: null })}>
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
