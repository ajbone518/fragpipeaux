import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

/** Shows what broke (with a way out) instead of unmounting to a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="boot" role="alert" style={{ maxWidth: 640, margin: "14vh auto 0", padding: "0 16px" }}>
        <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          The app hit an unexpected error. Your data never left this tab. Try again, or start over with a fresh page.
        </p>
        <pre className="methods" style={{ whiteSpace: "pre-wrap", marginBottom: 16 }}>{error.message}</pre>
        <div className="row">
          <button className="btn primary" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn" onClick={() => location.reload()}>Reload page</button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
