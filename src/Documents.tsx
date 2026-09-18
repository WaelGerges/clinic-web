import { useEffect, useState } from 'react';
import { api, downloadDocument, prepareUpload, uploadDocument, type UploadIntent } from './api';
import type { Attachment, Patient } from './domain';
import { useWorkspace } from './state';
import { useLanguage } from './i18n';
import { useOperation, useResource } from './hooks';
import { Button, Empty, ErrorMessage, Field, Modal, OperationNotice, Pager } from './ui';
export function Documents({ patient, visitId }: { patient: Patient; visitId?: string }) {
  const { membership: m, revision, refresh, online } = useWorkspace(),
    { t } = useLanguage();
  const [page, setPage] = useState(0),
    [upload, setUpload] = useState(false),
    [preview, setPreview] = useState<{ url: string; doc: Attachment } | null>(null),
    [archived, setArchived] = useState(false),
    op = useOperation();
  const data = useResource(
    () => api.documents(m.clinic_id, patient.id, page * 50),
    [patient.id, page, revision].join(':'),
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const open = (doc: Attachment, download: boolean) =>
    void op.run(async () => {
      const blob = await downloadDocument(doc, download ? 'download' : 'preview'),
        url = URL.createObjectURL(blob);
      if (download) {
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.file_name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else setPreview({ url, doc });
    });
  return (
    <section className="documents">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t('THE DOCUMENT FILE')}</span>
          <h2>{t('Documents')}</h2>
        </div>
        <Button
          icon="plus"
          primary
          disabled={!online || patient.archived}
          onClick={() => setUpload(true)}
        >
          {t('Upload document')}
        </Button>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
        {t('Show archived documents')}
      </label>
      {data.error && <ErrorMessage message={data.error} retry={data.reload} />}
      <OperationNotice op={op} />
      <div className="document-list">
        {data.data
          ?.filter((doc) => archived || doc.state !== 'archived')
          .map((doc) => (
            <article key={doc.id} className="document-row">
              <div className="file-mark">
                {doc.content_type === 'application/pdf' ? 'PDF' : 'IMG'}
              </div>
              <div>
                <h3>{doc.file_name}</h3>
                <p>
                  {t(doc.category)} · {(doc.bytes / 1024).toFixed(0)} KB ·{' '}
                  {t(doc.clinical ? 'Clinical' : 'Administrative')} · {t(doc.state)}
                </p>
                {doc.notes && <p>{doc.notes}</p>}
              </div>
              <div className="inline-actions">
                {doc.state === 'ready' && (
                  <>
                    <Button disabled={op.busy || !online} onClick={() => open(doc, false)}>
                      {t('Preview')}
                    </Button>
                    <Button disabled={op.busy || !online} onClick={() => open(doc, true)}>
                      {t('Download')}
                    </Button>
                  </>
                )}
                {(m.role === 'doctor' || doc.uploaded_by === m.user_id) &&
                  ['ready', 'archived'].includes(doc.state) && (
                    <Button
                      disabled={op.busy || !online}
                      onClick={() => {
                        if (
                          confirm(
                            t(
                              doc.state === 'archived'
                                ? 'Restore this document?'
                                : 'Archive this document? The file will be retained.',
                            ),
                          )
                        )
                          void op.run(async () => {
                            await api.archiveDocument(doc.id, doc.state !== 'archived');
                            refresh();
                          });
                      }}
                    >
                      {t(doc.state === 'archived' ? 'Restore' : 'Archive')}
                    </Button>
                  )}
              </div>
            </article>
          ))}
      </div>
      {data.data?.length === 0 && (
        <Empty title="No documents yet.">
          {t('Keep labs, radiology, referrals and consent forms with the patient record.')}
        </Empty>
      )}
      <Pager page={page} count={data.data?.length || 0} onChange={setPage} />
      {upload && (
        <UploadForm patient={patient} visitId={visitId} onClose={() => setUpload(false)} />
      )}
      {preview && (
        <Modal title={preview.doc.file_name} wide onClose={() => setPreview(null)}>
          {preview.doc.content_type === 'application/pdf' ? (
            <iframe className="document-preview" title={preview.doc.file_name} src={preview.url} />
          ) : (
            <img className="document-image" src={preview.url} alt={preview.doc.file_name} />
          )}
        </Modal>
      )}
    </section>
  );
}
function UploadForm({
  patient,
  visitId,
  onClose,
}: {
  patient: Patient;
  visitId?: string;
  onClose: () => void;
}) {
  const { membership: m, refresh, online } = useWorkspace(),
    { t } = useLanguage(),
    op = useOperation();
  const [file, setFile] = useState<File | null>(null),
    [category, setCategory] = useState('Other'),
    [notes, setNotes] = useState(''),
    [clinical, setClinical] = useState(m.role === 'doctor'),
    [linkVisit, setLinkVisit] = useState(Boolean(visitId));
  return (
    <Modal title="Upload document" onClose={onClose} locked={op.busy || op.uncertain}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          let intent: UploadIntent | undefined;
          void op.run(async () => {
            if (!file) throw new Error(t('Choose a file.'));
            intent ??= await prepareUpload(
              m,
              patient,
              file,
              category,
              notes,
              clinical,
              linkVisit ? visitId || null : null,
            );
            await uploadDocument(intent);
            refresh();
            onClose();
          });
        }}
      >
        <fieldset disabled={op.busy || op.uncertain || !online}>
          <Field label="File" hint="PDF, JPEG, PNG or WebP. Up to 20 MB.">
            <input
              type="file"
              required
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </Field>
          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {['Lab', 'Radiology', 'Referral', 'Consent', 'Other'].map((x) => (
                <option key={x} value={x}>
                  {t(x)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <textarea
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          {(m.role === 'doctor' || m.clinical_read) && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={clinical}
                onChange={(e) => setClinical(e.target.checked)}
              />
              {t('Clinical document (restricted clinical access)')}
            </label>
          )}
          {visitId && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={linkVisit}
                onChange={(e) => setLinkVisit(e.target.checked)}
              />
              {t('Link to this visit')}
            </label>
          )}
          <div className="form-actions">
            <Button onClick={onClose}>{t('Cancel')}</Button>
            <Button primary type="submit">
              {t('Upload document')}
            </Button>
          </div>
        </fieldset>
        <OperationNotice op={op} />
      </form>
    </Modal>
  );
}
