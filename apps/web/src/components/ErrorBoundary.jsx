import { Component } from 'react';

/**
 * Keeps one broken part of the page from taking the whole page down. The error is still reported
 * (console.error, with the component stack) so a real bug stays visible; `fallback` gets a `reset`
 * to try rendering again. Use around one chat message, and once around the whole app.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = () => this.setState({ error: null });
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`[NAVI] ${this.props.name ?? 'render'} failed`, error, info?.componentStack);
  }

  render() {
    if (this.state.error) return this.props.fallback({ error: this.state.error, reset: this.reset });
    return this.props.children;
  }
}
