import { Component } from 'react';

/**
 * Last line of defence.
 *
 * Everything upstream validates the model's output, but a rendering bug in a
 * component should still not leave the user staring at a blank page. This
 * catches it, shows a way out, and keeps the app recoverable without a reload.
 */
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="state state--error" role="alert">
        <div className="state__icon" aria-hidden="true">
          !
        </div>
        <h2 className="state__title">This view crashed</h2>
        <p className="state__message">
          Something in the study set could not be rendered. Your saved sessions are untouched.
        </p>
        <div className="state__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset?.();
            }}
          >
            Start over
          </button>
        </div>
        <pre className="state__trace">{String(this.state.error?.message || this.state.error)}</pre>
      </div>
    );
  }
}
