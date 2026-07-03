import React from "react";

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Application render failed", error, errorInfo);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-startup-error" role="alert">
        <section>
          <h1>页面加载失败</h1>
          <p>前端应用启动时发生错误。请刷新页面；如果仍然失败，请打开浏览器控制台查看错误信息。</p>
          <pre>{this.state.error.message}</pre>
          <button type="button" onClick={() => window.location.reload()}>刷新页面</button>
        </section>
      </main>
    );
  }
}
