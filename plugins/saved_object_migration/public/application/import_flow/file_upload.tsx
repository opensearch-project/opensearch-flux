import React, { useState } from 'react';
import { EuiFilePicker, EuiButton, EuiFlexGroup, EuiFlexItem, EuiSpacer, EuiText } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { CoreStart } from '../../../../../src/core/public';
import { InspectResponse } from '../../../common/api_types';
import { ImportFlowAction } from './index';

interface FileUploadProps {
  http: CoreStart['http'];
  dispatch: React.Dispatch<ImportFlowAction>;
}

export const FileUpload: React.FC<FileUploadProps> = ({ http, dispatch }) => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFileChange = (files: FileList | null) => {
    setFile(files?.[0] ?? null);
  };

  const handleNext = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const ndjson = await file.text();
      const inspectionReport = await http.post<InspectResponse>(
        '/api/saved_object_migration/inspect',
        { body: JSON.stringify({ ndjson }) }
      );
      dispatch({ type: 'SET_UPLOAD', payload: { fileName: file.name, ndjson, inspectionReport } });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err instanceof Error ? err.message : 'Failed to inspect file' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <EuiSpacer />
      <EuiFlexGroup justifyContent="center">
        <EuiFlexItem grow={false} style={{ minWidth: 400 }}>
          <EuiFilePicker
        accept=".ndjson"
        onChange={handleFileChange}
        display="large"
        initialPromptText={i18n.translate('savedObjectMigration.import.filePickerPrompt', {
          defaultMessage: 'Select or drag an .ndjson file',
        })}
      />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      <EuiText size="xs" color="subdued" textAlign="center">
        {i18n.translate('savedObjectMigration.import.fileNotModified', {
          defaultMessage: 'Your uploaded file will not be modified. All repairs and transformations are applied to a copy in memory.',
        })}
      </EuiText>
      <EuiSpacer />
      <EuiFlexGroup justifyContent="flexEnd">
        <EuiFlexItem grow={false}>
          <EuiButton fill onClick={handleNext} disabled={!file || loading} isLoading={loading}>
            {i18n.translate('savedObjectMigration.import.nextButton', { defaultMessage: 'Next' })}
          </EuiButton>
        </EuiFlexItem>
      </EuiFlexGroup>
    </>
  );
};
