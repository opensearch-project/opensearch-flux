import React from 'react';
import { EuiCallOut } from '@elastic/eui';

interface ErrorBannerProps {
  title: string;
  error: string | Error;
  onDismiss?: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ title, error, onDismiss }) => {
  const errorMessage = error instanceof Error ? error.message : error;

  return (
    <div role="alert" aria-live="assertive">
      <EuiCallOut
        color="danger"
        title={title}
        onDismiss={onDismiss}
        iconType="alert"
      >
        <p>{errorMessage}</p>
      </EuiCallOut>
    </div>
  );
};
