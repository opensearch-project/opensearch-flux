import React, { useReducer } from 'react';
import { i18n } from '@osd/i18n';
import { CoreStart } from '../../../../../src/core/public';
import { InspectionReport, RepairResult } from '../../../common/types';
import { ImportResponse } from '../../../common/api_types';
import { StepIndicator, ErrorBanner } from '../components';
import { FileUpload } from './file_upload';
import { Inspection } from './inspection';
import { RepairConfigStep } from './repair_config';
import { Preview } from './preview';
import { ImportConfigStep } from './import_config';
import { Result } from './result';

export type ImportResult = ImportResponse;

export interface ImportFlowState {
  currentStep: number;
  uploadedFileName: string;
  ndjson: string;
  inspectionReport: InspectionReport | null;
  repairConfig: RepairConfig | null;
  repairedNdjson: string;
  repairChanges: string[];
  previewReport: InspectionReport | null;
  selectedObjectIds: Set<string>;
  filteredNdjson: string;
  importConfig: { workspaceId?: string; newWorkspace?: { name: string; type: string; description?: string; dataSourceId?: string }; createNewCopies: boolean; overwrite: boolean };
  importResult: ImportResult | null;
  error: string | null;
}

export type ImportFlowAction =
  | { type: 'SET_UPLOAD'; payload: { fileName: string; ndjson: string; inspectionReport: InspectionReport } }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'SET_REPAIR_RESULT'; payload: RepairResult & { config: RepairConfig } }
  | { type: 'SET_PREVIEW_RESULT'; payload: { previewReport: InspectionReport; selectedObjectIds: Set<string>; filteredNdjson: string } }
  | { type: 'SET_IMPORT_RESULT'; payload: ImportResult }
  | { type: 'SET_ERROR'; payload: string }
  | { type: 'CLEAR_ERROR' };

const initialState: ImportFlowState = {
  currentStep: 0,
  uploadedFileName: '',
  ndjson: '',
  inspectionReport: null,
  repairConfig: null,
  repairedNdjson: '',
  repairChanges: [],
  previewReport: null,
  selectedObjectIds: new Set(),
  filteredNdjson: '',
  importConfig: { createNewCopies: true, overwrite: false },
  importResult: null,
  error: null,
};

// Steps: 0=Upload, 1=Inspect, 2=Repair, 3=Preview, 4=ImportConfig, 5=Result
function reducer(state: ImportFlowState, action: ImportFlowAction): ImportFlowState {
  switch (action.type) {
    case 'SET_UPLOAD':
      return {
        ...initialState,
        currentStep: 1,
        uploadedFileName: action.payload.fileName,
        ndjson: action.payload.ndjson,
        inspectionReport: action.payload.inspectionReport,
      };
    case 'NEXT_STEP':
      return { ...state, currentStep: state.currentStep + 1, error: null };
    case 'PREV_STEP': {
      const prev = Math.max(0, state.currentStep - 1);
      if (prev === 0) return { ...initialState };
      if (prev === 1) return { ...state, currentStep: prev, repairConfig: null, repairedNdjson: '', repairChanges: [], previewReport: null, selectedObjectIds: new Set(), filteredNdjson: '', importResult: null, error: null };
      if (prev === 2) return { ...state, currentStep: prev, repairedNdjson: '', repairChanges: [], previewReport: null, selectedObjectIds: new Set(), filteredNdjson: '', importResult: null, error: null };
      if (prev === 3) return { ...state, currentStep: prev, previewReport: null, selectedObjectIds: new Set(), filteredNdjson: '', importResult: null, error: null };
      return { ...state, currentStep: prev, importResult: null, error: null };
    }
    case 'SET_REPAIR_RESULT':
      return { ...state, repairConfig: action.payload.config, repairedNdjson: action.payload.ndjson, repairChanges: action.payload.changes, currentStep: 3, error: null };
    case 'SET_PREVIEW_RESULT':
      return { ...state, previewReport: action.payload.previewReport, selectedObjectIds: action.payload.selectedObjectIds, filteredNdjson: action.payload.filteredNdjson, currentStep: 4, error: null };
    case 'SET_IMPORT_RESULT':
      return { ...state, importResult: action.payload, currentStep: 5, error: null };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

interface ImportFlowProps {
  http: CoreStart['http'];
  notifications: CoreStart['notifications'];
  workspaceId?: string;
}

export const ImportFlow: React.FC<ImportFlowProps> = ({ http, notifications, workspaceId }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  const stepTitles = [
    i18n.translate('savedObjectMigration.import.step.upload', { defaultMessage: 'Upload' }),
    i18n.translate('savedObjectMigration.import.step.inspect', { defaultMessage: 'Inspect' }),
    i18n.translate('savedObjectMigration.import.step.repair', { defaultMessage: 'Repair' }),
    i18n.translate('savedObjectMigration.import.step.preview', { defaultMessage: 'Preview' }),
    i18n.translate('savedObjectMigration.import.step.configure', { defaultMessage: 'Configure' }),
    i18n.translate('savedObjectMigration.import.step.result', { defaultMessage: 'Result' }),
  ];

  const steps = stepTitles.map((title, i) => ({
    title,
    status: (i < state.currentStep ? 'complete' : i === state.currentStep ? 'current' : 'incomplete') as 'complete' | 'current' | 'incomplete',
  }));

  return (
    <>
      <StepIndicator steps={steps} />
      {state.error && (
        <ErrorBanner
          title={i18n.translate('savedObjectMigration.import.errorTitle', { defaultMessage: 'Error' })}
          error={state.error}
          onDismiss={() => dispatch({ type: 'CLEAR_ERROR' })}
        />
      )}
      {state.currentStep === 0 && <FileUpload http={http} dispatch={dispatch} />}
      {state.currentStep === 1 && <Inspection inspectionReport={state.inspectionReport!} dispatch={dispatch} />}
      {state.currentStep === 2 && <RepairConfigStep ndjson={state.ndjson} http={http} dispatch={dispatch} />}
      {state.currentStep === 3 && (
        <Preview
          ndjson={state.repairedNdjson || state.ndjson}
          originalReport={state.inspectionReport!}
          repairConfig={state.repairConfig ?? undefined}
          dispatch={dispatch}
        />
      )}
      {state.currentStep === 4 && (
        <ImportConfigStep
          ndjson={state.filteredNdjson || state.repairedNdjson || state.ndjson}
          repairChanges={state.repairChanges}
          http={http}
          dispatch={dispatch}
          workspaceId={workspaceId}
        />
      )}
      {state.currentStep === 5 && <Result result={state.importResult!} />}
    </>
  );
};
