import React from 'react';
import { EuiStepsHorizontal, EuiStepsHorizontalProps } from '@elastic/eui';
import { i18n } from '@osd/i18n';

interface StepIndicatorProps {
  steps: Array<{
    title: string;
    status?: 'complete' | 'current' | 'incomplete' | 'disabled';
  }>;
  currentStep?: number;
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({ steps, currentStep }) => {
  const euiSteps: EuiStepsHorizontalProps['steps'] = steps.map((step, index) => ({
    title: step.title,
    status:
      step.status ??
      (currentStep !== undefined
        ? index < currentStep
          ? 'complete'
          : index === currentStep
          ? 'current'
          : 'incomplete'
        : 'incomplete'),
    onClick: () => {},
  }));

  return (
    <EuiStepsHorizontal
      steps={euiSteps}
      aria-label={i18n.translate('savedObjectMigration.stepIndicator.label', {
        defaultMessage: 'Progress steps',
      })}
    />
  );
};
