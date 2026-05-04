import { Component } from 'react'
import * as Sentry from '@sentry/react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Something went wrong.' }
  }

  componentDidCatch(error, info) {
    // Log to console and report to Sentry
    console.error('[ErrorBoundary]', error, info?.componentStack)
    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: info?.componentStack,
        },
      },
    })
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '' })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div
          className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center"
          style={{ background: 'transparent' }}
        >
          <div
            className="max-w-md rounded-[28px] p-8"
            style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
          >
            <p className="kicker">Error</p>
            <h2
              className="serif-display mt-3 text-2xl font-semibold"
              style={{ color: 'var(--text)' }}
            >
              Something went wrong
            </h2>
            <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="mt-6 rounded-full px-5 py-2 text-sm font-semibold transition-transform hover:-translate-y-[1px]"
              style={{
                background: 'var(--accent-soft)',
                border: '1px solid var(--line-strong)',
                color: 'var(--text)',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
