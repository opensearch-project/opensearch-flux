import React from 'react';
import { EuiCallOut, EuiButtonIcon, EuiFlexGroup, EuiFlexItem } from '@elastic/eui';
import { i18n } from '@osd/i18n';

interface ErrorBannerProps {
  title: string;
  error: string | Error;
  onDismiss?: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ title, error, onDismiss }) => {
  const errorMessage = error instanceof Error ? error.message : error;

  return (
    <div role="alert" aria-live="assertive">
      <EuiCallOut color="danger" title={title} iconType="alert">
        <EuiFlexGroup justifyContent="spaceBetween" alignItems="flexStart" gutterSize="s">
          <EuiFlexItem>
            <p>{errorMessage}</p>
          </EuiFlexItem>
          {onDismiss && (
            <EuiFlexItem grow={false}>
              <EuiButtonIcon
                iconType="cross"
                color="danger"
                aria-label={i18n.translate('savedObjectMigration.errorBanner.dismiss', {
                  defaultMessage: 'Dismiss',
                })}
                onClick={onDismiss}
              />
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
      </EuiCallOut>
    </div>
  );
};
