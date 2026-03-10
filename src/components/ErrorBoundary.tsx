import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

function FallbackUI() {
  const lang = document.documentElement.lang;
  const isZh = lang?.startsWith("zh");
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold">
          {isZh ? "页面出错了" : "Something went wrong"}
        </h1>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md"
        >
          {isZh ? "重新加载" : "Reload Page"}
        </button>
      </div>
    </div>
  );
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <FallbackUI />;
    }
    return this.props.children;
  }
}

