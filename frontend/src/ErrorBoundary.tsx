import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Catches render/effect errors so a bug can never leave a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Surface it in the console but keep the app usable.
    console.error('Dashboard error (recovered):', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="boundary">
          <h2>Something hiccuped</h2>
          <p>The dashboard hit an error but stayed up. It usually recovers on its own.</p>
          <button onClick={() => this.setState({ error: null })}>Reload view</button>
        </div>
      )
    }
    return this.props.children
  }
}
