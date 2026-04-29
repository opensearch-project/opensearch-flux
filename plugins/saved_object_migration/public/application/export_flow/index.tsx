import React, { useReducer } from 'react';
import { i18n } from '@osd/i18n';
import { CoreStart } from '../../../../../src/core/public';
import { StepIndicator } from '../components';
import { InspectionReport } from '../../../common/types';
import { DashboardSelect } from './dashboard_select';
import { Inspection } from './inspection';
import { Download } from './download';

interface ExportFlowState {
  currentStep: number;
  selectedDashboards: Array<{ id: string; title: string }>;
  ndjson: string;
  inspectionReport: InspectionReport | null;
  error: string | null;
}

type ExportFlowAction =
  | { type: 'SET_SELECTED_DASHBOARDS'; payload: Array<{ id: string; title: string }> }
  | { type: 'SET_EXPORT_RESULT'; payload: { ndjson: string; inspectionReport: InspectionReport } }
  | { type: 'SET_ERROR'; payload: string }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' };

const initialState: ExportFlowState = {
  currentStep: 0,
  selectedDashboards: [],
  ndjson: '',
  inspectionReport: null,
  error: null,
};

function reducer(state: ExportFlowState, action: ExportFlowAction): ExportFlowState {
  switch (action.type) {
    case 'SET_SELECTED_DASHBOARDS':
      return { ...state, selectedDashboards: action.payload };
    case 'SET_EXPORT_RESULT':
      return {
        ...state,
        ndjson: action.payload.ndjson,
        inspectionReport: action.payload.inspectionReport,
        currentStep: 1,
        error: null,
      };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'NEXT_STEP':
      return { ...state, currentStep: state.currentStep + 1 };
    case 'PREV_STEP':
      return { ...state, currentStep: Math.max(0, state.currentStep - 1) };
    default:
      return state;
  }
}

interface ExportFlowProps {
  http: CoreStart['http'];
  notifications: CoreStart['notifications'];
  workspaceId?: string;
}

export const ExportFlow: React.FC<ExportFlowProps> = ({ http, notifications, workspaceId }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  const steps = [
    {
      title: i18n.translate('savedObjectMigration.export.step.select', {
        defaultMessage: 'Select Dashboards',
      }),
    },
    {
      title: i18n.translate('savedObjectMigration.export.step.inspect', {
        defaultMessage: 'Inspect',
      }),
    },
    {
      title: i18n.translate('savedObjectMigration.export.step.download', {
        defaultMessage: 'Download',
      }),
    },
  ];

  return (
    <>
      <StepIndicator steps={steps} currentStep={state.currentStep} />
      {state.currentStep === 0 && (
        <DashboardSelect http={http} notifications={notifications} dispatch={dispatch} workspaceId={workspaceId} />
      )}
      {state.currentStep === 1 && (
        <Inspection
          inspectionReport={state.inspectionReport!}
          dispatch={dispatch}
        />
      )}
      {state.currentStep === 2 && (
        <Download ndjson={state.ndjson} />
      )}
    </>
  );
};
