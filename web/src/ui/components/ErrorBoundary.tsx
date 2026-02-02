import React from 'react';

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="panel" style={{ margin: 20 }}>
          <h1 className="brand">Something went wrong</h1>
          <p className="subtitle">The app hit an error and stopped rendering.</p>
          <div className="output">{this.state.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}
